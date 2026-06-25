from datetime import datetime, timezone
from typing import Any

from sqlalchemy import (
    JSON, Boolean, DateTime, Float, ForeignKey,
    Integer, String, Text, UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class ApiKey(Base):
    __tablename__ = "api_keys"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(128))
    key_hash: Mapped[str] = mapped_column(String(256), unique=True, index=True)
    key_prefix: Mapped[str] = mapped_column(String(12))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    entities: Mapped[list["Entity"]] = relationship(back_populates="api_key")
    webhooks: Mapped[list["Webhook"]] = relationship(back_populates="api_key")


class SignalDefinition(Base):
    """A named, directional observable (e.g. 'support_tickets_open', 'days_since_login')."""
    __tablename__ = "signal_definitions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    description: Mapped[str] = mapped_column(Text, default="")
    direction: Mapped[str] = mapped_column(String(32), default="higher_is_worse")
    # {"lambda": float, "amplitude": float, "peak_lead_time_h": float, "n_samples": int}
    decay_params: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    observations: Mapped[list["Observation"]] = relationship(back_populates="signal")


class Entity(Base):
    """A tracked object approaching a causal horizon (user trial, deployment, incident, etc.)."""
    __tablename__ = "entities"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    external_id: Mapped[str] = mapped_column(String(256), index=True)
    api_key_id: Mapped[int] = mapped_column(ForeignKey("api_keys.id"))
    entity_type: Mapped[str] = mapped_column(String(64), default="generic", index=True)
    label: Mapped[str | None] = mapped_column(String(256), nullable=True)

    # Causal window
    deadline_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    window_hours: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Lifecycle
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    outcome: Mapped[str | None] = mapped_column(String(32), nullable=True)  # "positive" | "negative"

    # Cached urgency (updated on each observe call)
    urgency_score: Mapped[float] = mapped_column(Float, default=0.0)
    urgency_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Has an alert already fired for this entity? Reset on significant urgency increase.
    last_alerted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_alert_score: Mapped[float] = mapped_column(Float, default=0.0)

    api_key: Mapped["ApiKey"] = relationship(back_populates="entities")
    observations: Mapped[list["Observation"]] = relationship(back_populates="entity", order_by="Observation.observed_at")
    alerts: Mapped[list["HorizonAlert"]] = relationship(back_populates="entity")

    __table_args__ = (UniqueConstraint("external_id", "api_key_id"),)


class Observation(Base):
    """A signal value recorded for an entity at a point in time."""
    __tablename__ = "observations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    entity_id: Mapped[int] = mapped_column(ForeignKey("entities.id"), index=True)
    signal_id: Mapped[int] = mapped_column(ForeignKey("signal_definitions.id"), index=True)
    value: Mapped[float] = mapped_column(Float)
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    entity: Mapped["Entity"] = relationship(back_populates="observations")
    signal: Mapped["SignalDefinition"] = relationship(back_populates="observations")


class HorizonAlert(Base):
    """Fired when an entity's urgency crosses the alert threshold."""
    __tablename__ = "horizon_alerts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    entity_id: Mapped[int] = mapped_column(ForeignKey("entities.id"), index=True)
    urgency_score: Mapped[float] = mapped_column(Float)
    severity: Mapped[str] = mapped_column(String(16))
    lead_time_h: Mapped[float | None] = mapped_column(Float, nullable=True)
    signals_snapshot: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    fired_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    webhook_delivered: Mapped[bool] = mapped_column(Boolean, default=False)

    entity: Mapped["Entity"] = relationship(back_populates="alerts")


class Webhook(Base):
    __tablename__ = "webhooks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    api_key_id: Mapped[int] = mapped_column(ForeignKey("api_keys.id"))
    url: Mapped[str] = mapped_column(Text)
    secret: Mapped[str | None] = mapped_column(String(256), nullable=True)
    events: Mapped[list[str]] = mapped_column(JSON, default=list)
    alert_threshold: Mapped[float] = mapped_column(Float, default=70.0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    last_delivery_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_delivery_status: Mapped[int | None] = mapped_column(Integer, nullable=True)

    api_key: Mapped["ApiKey"] = relationship(back_populates="webhooks")
    deliveries: Mapped[list["WebhookDelivery"]] = relationship(back_populates="webhook")


class WebhookDelivery(Base):
    __tablename__ = "webhook_deliveries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    webhook_id: Mapped[int] = mapped_column(ForeignKey("webhooks.id"), index=True)
    alert_id: Mapped[int | None] = mapped_column(ForeignKey("horizon_alerts.id"), nullable=True)
    attempted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    status_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    success: Mapped[bool] = mapped_column(Boolean, default=False)
    attempt: Mapped[int] = mapped_column(Integer, default=1)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)

    webhook: Mapped["Webhook"] = relationship(back_populates="deliveries")
