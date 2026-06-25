from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_api_key
from app.database import get_db
from app.models import ApiKey, SignalDefinition
from app.services.decay import fit_signal_decay

router = APIRouter(prefix="/api/v1/signals", tags=["signals"])


class CreateSignalRequest(BaseModel):
    name: str
    description: str = ""
    direction: str = "higher_is_worse"  # "higher_is_worse" | "lower_is_worse"


@router.post("")
async def create_signal(
    body: CreateSignalRequest,
    _: ApiKey = Depends(require_api_key),
    db: AsyncSession = Depends(get_db),
):
    if body.direction not in ("higher_is_worse", "lower_is_worse"):
        raise HTTPException(status_code=422, detail="direction must be 'higher_is_worse' or 'lower_is_worse'")
    existing = await db.execute(select(SignalDefinition).where(SignalDefinition.name == body.name))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail=f"Signal '{body.name}' already exists")
    sig = SignalDefinition(name=body.name, description=body.description, direction=body.direction)
    db.add(sig)
    await db.commit()
    await db.refresh(sig)
    return _signal_dict(sig)


@router.get("")
async def list_signals(
    _: ApiKey = Depends(require_api_key),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(SignalDefinition).order_by(SignalDefinition.name))
    sigs = result.scalars().all()
    return {"signals": [_signal_dict(s) for s in sigs]}


@router.get("/{name}")
async def get_signal(
    name: str,
    _: ApiKey = Depends(require_api_key),
    db: AsyncSession = Depends(get_db),
):
    sig = await _get_or_404(db, name)
    return _signal_dict(sig)


@router.post("/{name}/train")
async def train_signal(
    name: str,
    _: ApiKey = Depends(require_api_key),
    db: AsyncSession = Depends(get_db),
):
    sig = await _get_or_404(db, name)
    params = await fit_signal_decay(db, sig.id)
    if params is None:
        return {"trained": False, "reason": "Insufficient data (need >= 5 resolved entities with outcomes and >= 10 observations)"}
    sig.decay_params = params
    await db.commit()
    return {"trained": True, "decay_params": params}


@router.delete("/{name}")
async def delete_signal(
    name: str,
    _: ApiKey = Depends(require_api_key),
    db: AsyncSession = Depends(get_db),
):
    sig = await _get_or_404(db, name)
    await db.delete(sig)
    await db.commit()
    return {"deleted": True}


async def _get_or_404(db: AsyncSession, name: str) -> SignalDefinition:
    result = await db.execute(select(SignalDefinition).where(SignalDefinition.name == name))
    sig = result.scalar_one_or_none()
    if not sig:
        raise HTTPException(status_code=404, detail=f"Signal '{name}' not found")
    return sig


def _signal_dict(s: SignalDefinition) -> dict:
    return {
        "id": s.id,
        "name": s.name,
        "description": s.description,
        "direction": s.direction,
        "decay_params": s.decay_params,
        "created_at": s.created_at,
    }
