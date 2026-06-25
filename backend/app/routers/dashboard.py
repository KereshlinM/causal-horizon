from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_api_key
from app.database import get_db
from app.models import ApiKey, Entity, HorizonAlert, SignalDefinition

router = APIRouter(prefix="/api/v1/dashboard", tags=["dashboard"])


@router.get("/overview")
async def overview(
    api_key: ApiKey = Depends(require_api_key),
    db: AsyncSession = Depends(get_db),
):
    # Entity counts
    total_entities = await db.scalar(
        select(func.count(Entity.id)).where(Entity.api_key_id == api_key.id)
    ) or 0
    active_entities = await db.scalar(
        select(func.count(Entity.id)).where(
            Entity.api_key_id == api_key.id,
            Entity.resolved_at == None,
        )
    ) or 0
    resolved_entities = total_entities - active_entities

    # Urgency distribution among active entities
    critical = await db.scalar(
        select(func.count(Entity.id)).where(
            Entity.api_key_id == api_key.id,
            Entity.resolved_at == None,
            Entity.urgency_score >= 90,
        )
    ) or 0
    high = await db.scalar(
        select(func.count(Entity.id)).where(
            Entity.api_key_id == api_key.id,
            Entity.resolved_at == None,
            Entity.urgency_score >= 70,
            Entity.urgency_score < 90,
        )
    ) or 0
    medium = await db.scalar(
        select(func.count(Entity.id)).where(
            Entity.api_key_id == api_key.id,
            Entity.resolved_at == None,
            Entity.urgency_score >= 50,
            Entity.urgency_score < 70,
        )
    ) or 0

    # Total alerts fired
    total_alerts = await db.scalar(
        select(func.count(HorizonAlert.id))
        .join(Entity, HorizonAlert.entity_id == Entity.id)
        .where(Entity.api_key_id == api_key.id)
    ) or 0

    # Signal count
    signal_count = await db.scalar(select(func.count(SignalDefinition.id))) or 0

    # Most urgent active entities (top 10)
    top_result = await db.execute(
        select(Entity)
        .where(Entity.api_key_id == api_key.id, Entity.resolved_at == None)
        .order_by(Entity.urgency_score.desc())
        .limit(10)
    )
    top_entities = top_result.scalars().all()

    # Recent alerts
    recent_result = await db.execute(
        select(HorizonAlert, Entity)
        .join(Entity, HorizonAlert.entity_id == Entity.id)
        .where(Entity.api_key_id == api_key.id)
        .order_by(HorizonAlert.fired_at.desc())
        .limit(10)
    )
    recent_alerts = recent_result.all()

    return {
        "entities": {
            "total": total_entities,
            "active": active_entities,
            "resolved": resolved_entities,
        },
        "urgency_distribution": {
            "critical": critical,
            "high": high,
            "medium": medium,
            "low": active_entities - critical - high - medium,
        },
        "alerts": {"total": total_alerts},
        "signals": {"total": signal_count},
        "top_entities": [
            {
                "external_id": e.external_id,
                "entity_type": e.entity_type,
                "label": e.label,
                "urgency_score": e.urgency_score,
                "deadline_at": e.deadline_at,
                "window_hours": e.window_hours,
            }
            for e in top_entities
        ],
        "recent_alerts": [
            {
                "id": a.id,
                "entity_id": e.external_id,
                "entity_type": e.entity_type,
                "urgency_score": a.urgency_score,
                "severity": a.severity,
                "lead_time_h": a.lead_time_h,
                "fired_at": a.fired_at,
            }
            for a, e in recent_alerts
        ],
    }
