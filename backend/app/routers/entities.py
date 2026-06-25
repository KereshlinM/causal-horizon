from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth import require_api_key
from app.database import get_db
from app.models import ApiKey, Entity, HorizonAlert, Observation, SignalDefinition
from app.services.decay import compute_signal_baseline
from app.services.urgency import compute_urgency
from app.services.webhook import deliver_alert

router = APIRouter(prefix="/api/v1/entities", tags=["entities"])


class RegisterEntityRequest(BaseModel):
    external_id: str
    entity_type: str = "generic"
    label: str | None = None
    deadline_at: datetime | None = None
    window_hours: float | None = None


class ObserveRequest(BaseModel):
    signal: str
    value: float
    observed_at: datetime | None = None


class OutcomeRequest(BaseModel):
    outcome: str  # "positive" | "negative"


@router.post("")
async def register_entity(
    body: RegisterEntityRequest,
    api_key: ApiKey = Depends(require_api_key),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Entity).where(
            Entity.external_id == body.external_id,
            Entity.api_key_id == api_key.id,
        )
    )
    entity = result.scalar_one_or_none()

    window_hours = body.window_hours
    if window_hours is None and body.deadline_at is not None:
        now = datetime.now(timezone.utc)
        window_hours = max(1.0, (body.deadline_at - now).total_seconds() / 3600)

    if entity is None:
        entity = Entity(
            external_id=body.external_id,
            api_key_id=api_key.id,
            entity_type=body.entity_type,
            label=body.label,
            deadline_at=body.deadline_at,
            window_hours=window_hours,
        )
        db.add(entity)
    else:
        if body.deadline_at is not None:
            entity.deadline_at = body.deadline_at
        if window_hours is not None:
            entity.window_hours = window_hours
        if body.label is not None:
            entity.label = body.label

    await db.commit()
    await db.refresh(entity)
    return _entity_dict(entity)


@router.get("")
async def list_entities(
    entity_type: str | None = None,
    active_only: bool = True,
    limit: int = 100,
    offset: int = 0,
    api_key: ApiKey = Depends(require_api_key),
    db: AsyncSession = Depends(get_db),
):
    q = select(Entity).where(Entity.api_key_id == api_key.id)
    if entity_type:
        q = q.where(Entity.entity_type == entity_type)
    if active_only:
        q = q.where(Entity.resolved_at == None)
    q = q.order_by(Entity.urgency_score.desc()).limit(limit).offset(offset)
    result = await db.execute(q)
    entities = result.scalars().all()
    return {"entities": [_entity_dict(e) for e in entities]}


@router.get("/{external_id}")
async def get_entity(
    external_id: str,
    api_key: ApiKey = Depends(require_api_key),
    db: AsyncSession = Depends(get_db),
):
    entity = await _get_or_404(db, external_id, api_key.id)
    # Load latest observation per signal
    urgency_data = await _compute_and_attach(db, entity)
    d = _entity_dict(entity)
    d["urgency_detail"] = urgency_data
    d["alerts"] = await _recent_alerts(db, entity.id)
    return d


@router.post("/{external_id}/observe")
async def observe(
    external_id: str,
    body: ObserveRequest,
    background_tasks: BackgroundTasks,
    api_key: ApiKey = Depends(require_api_key),
    db: AsyncSession = Depends(get_db),
):
    entity = await _get_or_404(db, external_id, api_key.id)
    if entity.resolved_at is not None:
        raise HTTPException(status_code=409, detail="Entity is already resolved")

    # Upsert signal definition
    sig_result = await db.execute(
        select(SignalDefinition).where(SignalDefinition.name == body.signal)
    )
    signal = sig_result.scalar_one_or_none()
    if signal is None:
        signal = SignalDefinition(name=body.signal)
        db.add(signal)
        await db.flush()

    obs = Observation(
        entity_id=entity.id,
        signal_id=signal.id,
        value=body.value,
        observed_at=body.observed_at or datetime.now(timezone.utc),
    )
    db.add(obs)
    await db.commit()

    # Recompute urgency
    urgency_data = await _compute_and_attach(db, entity)
    await db.commit()

    # Fire alert if threshold crossed
    prev_score = entity.last_alert_score
    curr_score = entity.urgency_score
    if curr_score >= 70.0 and (entity.last_alerted_at is None or curr_score >= prev_score + 10.0):
        alert = HorizonAlert(
            entity_id=entity.id,
            urgency_score=curr_score,
            severity=urgency_data["severity"],
            lead_time_h=urgency_data.get("lead_time_h"),
            signals_snapshot=urgency_data.get("signals", {}),
        )
        db.add(alert)
        entity.last_alerted_at = datetime.now(timezone.utc)
        entity.last_alert_score = curr_score
        await db.commit()
        await db.refresh(alert)
        background_tasks.add_task(deliver_alert, db, entity, alert)

    return {
        "observed": True,
        "urgency_score": entity.urgency_score,
        "severity": urgency_data["severity"],
        "lead_time_h": urgency_data.get("lead_time_h"),
    }


@router.post("/{external_id}/outcome")
async def record_outcome(
    external_id: str,
    body: OutcomeRequest,
    api_key: ApiKey = Depends(require_api_key),
    db: AsyncSession = Depends(get_db),
):
    if body.outcome not in ("positive", "negative"):
        raise HTTPException(status_code=422, detail="outcome must be 'positive' or 'negative'")
    entity = await _get_or_404(db, external_id, api_key.id)
    entity.outcome = body.outcome
    entity.resolved_at = datetime.now(timezone.utc)
    await db.commit()
    return {"recorded": True, "outcome": body.outcome}


@router.get("/{external_id}/observations")
async def get_observations(
    external_id: str,
    limit: int = 100,
    api_key: ApiKey = Depends(require_api_key),
    db: AsyncSession = Depends(get_db),
):
    entity = await _get_or_404(db, external_id, api_key.id)
    result = await db.execute(
        select(Observation, SignalDefinition)
        .join(SignalDefinition, Observation.signal_id == SignalDefinition.id)
        .where(Observation.entity_id == entity.id)
        .order_by(Observation.observed_at.desc())
        .limit(limit)
    )
    rows = result.all()
    return {"observations": [
        {
            "id": o.id,
            "signal": s.name,
            "direction": s.direction,
            "value": o.value,
            "observed_at": o.observed_at,
        }
        for o, s in rows
    ]}


# ---- helpers ----

async def _get_or_404(db: AsyncSession, external_id: str, api_key_id: int) -> Entity:
    result = await db.execute(
        select(Entity).where(
            Entity.external_id == external_id,
            Entity.api_key_id == api_key_id,
        )
    )
    entity = result.scalar_one_or_none()
    if entity is None:
        raise HTTPException(status_code=404, detail="Entity not found")
    return entity


async def _compute_and_attach(db: AsyncSession, entity: Entity) -> dict[str, Any]:
    """Compute urgency, update entity.urgency_score, return urgency detail dict."""
    # Get latest observation per signal
    sub = (
        select(func.max(Observation.id))
        .where(Observation.entity_id == entity.id)
        .group_by(Observation.signal_id)
    ).scalar_subquery()
    obs_result = await db.execute(
        select(Observation, SignalDefinition)
        .join(SignalDefinition, Observation.signal_id == SignalDefinition.id)
        .where(Observation.id.in_(sub))
    )
    rows = obs_result.all()

    observations = []
    for obs, sig in rows:
        baseline = await compute_signal_baseline(db, sig.id)
        if baseline is None:
            continue
        mean, std = baseline
        observations.append((sig.name, sig.direction, obs.value, sig.decay_params, mean, std))

    result = compute_urgency(
        created_at=entity.created_at,
        deadline_at=entity.deadline_at,
        window_hours=entity.window_hours,
        observations=observations,
    )

    entity.urgency_score = result.urgency_score
    entity.urgency_updated_at = datetime.now(timezone.utc)

    return {
        "urgency_score": result.urgency_score,
        "deadline_score": result.deadline_score,
        "signal_score": result.signal_score,
        "severity": result.severity,
        "lead_time_h": result.lead_time_h,
        "signals": result.signals,
    }


async def _recent_alerts(db: AsyncSession, entity_id: int, limit: int = 10) -> list[dict]:
    result = await db.execute(
        select(HorizonAlert)
        .where(HorizonAlert.entity_id == entity_id)
        .order_by(HorizonAlert.fired_at.desc())
        .limit(limit)
    )
    alerts = result.scalars().all()
    return [
        {
            "id": a.id,
            "urgency_score": a.urgency_score,
            "severity": a.severity,
            "lead_time_h": a.lead_time_h,
            "fired_at": a.fired_at,
            "webhook_delivered": a.webhook_delivered,
        }
        for a in alerts
    ]


def _entity_dict(e: Entity) -> dict[str, Any]:
    return {
        "id": e.id,
        "external_id": e.external_id,
        "entity_type": e.entity_type,
        "label": e.label,
        "deadline_at": e.deadline_at,
        "window_hours": e.window_hours,
        "urgency_score": e.urgency_score,
        "urgency_updated_at": e.urgency_updated_at,
        "outcome": e.outcome,
        "created_at": e.created_at,
        "resolved_at": e.resolved_at,
    }
