"""Deliver horizon alerts to registered webhooks."""

from __future__ import annotations

import hashlib
import hmac
import json
from datetime import datetime, timezone

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Entity, HorizonAlert, Webhook, WebhookDelivery


async def deliver_alert(
    db: AsyncSession,
    entity: Entity,
    alert: HorizonAlert,
) -> None:
    result = await db.execute(
        select(Webhook).where(
            Webhook.api_key_id == entity.api_key_id,
            Webhook.is_active == True,
            Webhook.alert_threshold <= alert.urgency_score,
        )
    )
    webhooks = result.scalars().all()
    if not webhooks:
        return

    payload = {
        "event": "horizon.alert",
        "entity_id": entity.external_id,
        "entity_type": entity.entity_type,
        "label": entity.label,
        "urgency_score": alert.urgency_score,
        "severity": alert.severity,
        "lead_time_h": alert.lead_time_h,
        "signals": alert.signals_snapshot,
        "deadline_at": entity.deadline_at.isoformat() if entity.deadline_at else None,
        "fired_at": alert.fired_at.isoformat(),
    }
    body = json.dumps(payload).encode()

    delivered_any = False
    async with httpx.AsyncClient(timeout=10.0) as client:
        for wh in webhooks:
            headers = {"Content-Type": "application/json"}
            if wh.secret:
                sig = hmac.new(wh.secret.encode(), body, hashlib.sha256).hexdigest()
                headers["X-Horizon-Signature"] = f"sha256={sig}"

            status_code = None
            error = None
            success = False
            for attempt in range(1, 3):
                try:
                    resp = await client.post(wh.url, content=body, headers=headers)
                    status_code = resp.status_code
                    success = resp.status_code < 400
                    if success:
                        break
                except Exception as exc:
                    error = str(exc)

            delivery = WebhookDelivery(
                webhook_id=wh.id,
                alert_id=alert.id,
                attempted_at=datetime.now(timezone.utc),
                status_code=status_code,
                success=success,
                attempt=attempt,
                error=error,
            )
            db.add(delivery)
            wh.last_delivery_at = delivery.attempted_at
            wh.last_delivery_status = status_code
            if success:
                delivered_any = True

    if delivered_any:
        alert.webhook_delivered = True

    await db.commit()
