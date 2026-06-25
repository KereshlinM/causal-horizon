from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_api_key
from app.database import get_db
from app.models import ApiKey, Webhook, WebhookDelivery

router = APIRouter(prefix="/api/v1/webhooks", tags=["webhooks"])


class CreateWebhookRequest(BaseModel):
    url: str
    secret: str | None = None
    events: list[str] = ["horizon.alert"]
    alert_threshold: float = 70.0


@router.post("")
async def create_webhook(
    body: CreateWebhookRequest,
    api_key: ApiKey = Depends(require_api_key),
    db: AsyncSession = Depends(get_db),
):
    wh = Webhook(
        api_key_id=api_key.id,
        url=body.url,
        secret=body.secret,
        events=body.events,
        alert_threshold=body.alert_threshold,
    )
    db.add(wh)
    await db.commit()
    await db.refresh(wh)
    return _wh_dict(wh)


@router.get("")
async def list_webhooks(
    api_key: ApiKey = Depends(require_api_key),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Webhook).where(Webhook.api_key_id == api_key.id, Webhook.is_active == True)
    )
    whs = result.scalars().all()
    return {"webhooks": [_wh_dict(w) for w in whs]}


@router.delete("/{webhook_id}")
async def delete_webhook(
    webhook_id: int,
    api_key: ApiKey = Depends(require_api_key),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Webhook).where(Webhook.id == webhook_id, Webhook.api_key_id == api_key.id)
    )
    wh = result.scalar_one_or_none()
    if not wh:
        raise HTTPException(status_code=404, detail="Webhook not found")
    wh.is_active = False
    await db.commit()
    return {"deleted": True}


@router.get("/{webhook_id}/deliveries")
async def webhook_deliveries(
    webhook_id: int,
    limit: int = 50,
    api_key: ApiKey = Depends(require_api_key),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(WebhookDelivery)
        .where(WebhookDelivery.webhook_id == webhook_id)
        .order_by(WebhookDelivery.attempted_at.desc())
        .limit(limit)
    )
    deliveries = result.scalars().all()
    return {"deliveries": [
        {
            "id": d.id,
            "attempted_at": d.attempted_at,
            "status_code": d.status_code,
            "success": d.success,
            "attempt": d.attempt,
            "error": d.error,
        }
        for d in deliveries
    ]}


def _wh_dict(w: Webhook) -> dict:
    return {
        "id": w.id,
        "url": w.url,
        "events": w.events,
        "alert_threshold": w.alert_threshold,
        "last_delivery_at": w.last_delivery_at,
        "last_delivery_status": w.last_delivery_status,
    }
