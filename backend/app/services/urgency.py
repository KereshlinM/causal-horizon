"""Compute causal urgency scores for entities."""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime, timezone


@dataclass
class UrgencyResult:
    urgency_score: float
    deadline_score: float
    signal_score: float
    severity: str
    lead_time_h: float | None
    signals: dict = field(default_factory=dict)


def compute_urgency(
    created_at: datetime,
    deadline_at: datetime | None,
    window_hours: float | None,
    # list of (signal_name, direction, value, decay_params, global_mean, global_std)
    observations: list[tuple],
) -> UrgencyResult:
    now = datetime.now(timezone.utc)

    # --- Deadline component: 0-60 points ---
    lead_time_h: float | None = None
    deadline_score = 0.0

    if deadline_at is not None and window_hours and window_hours > 0:
        remaining_s = (deadline_at - now).total_seconds()
        remaining_h = max(0.0, remaining_s / 3600)
        lead_time_h = remaining_h
        fraction_remaining = min(1.0, remaining_h / window_hours)
        fraction_elapsed = 1.0 - fraction_remaining
        # Curve: slow in first half, accelerates toward deadline
        deadline_score = 60.0 * (fraction_elapsed ** 0.55)

    # --- Signal component: 0-40 points ---
    signal_breakdown: dict = {}
    weighted_pressures: list[float] = []

    for signal_name, direction, value, decay_params, global_mean, global_std in observations:
        if global_std is None or global_std < 1e-9:
            continue

        z = (value - global_mean) / global_std
        if direction == "lower_is_worse":
            z = -z

        z_alarming = max(0.0, min(4.0, z))

        # Causal weight: how actionable is this signal at the current lead time?
        # Bell curve peaking at 1/lambda hours before deadline.
        # At lead_time=0: weight=0 (too late). At peak: weight=1. Far away: weight~0.
        causal_weight = 1.0
        if decay_params and lead_time_h is not None:
            lam = float(decay_params.get("lambda", 0.04))
            amp = float(decay_params.get("amplitude", 1.0))
            # Normalized so peak = amp
            peak = amp * lead_time_h * math.exp(-lam * lead_time_h) * lam * math.e
            causal_weight = max(0.05, min(1.0, peak))

        contribution = z_alarming * causal_weight
        weighted_pressures.append(contribution)

        signal_breakdown[signal_name] = {
            "value": round(value, 4),
            "z_score": round(z, 3),
            "causal_weight": round(causal_weight, 3),
            "contribution": round(contribution, 3),
            "direction": direction,
        }

    if weighted_pressures:
        avg_pressure = sum(weighted_pressures) / len(weighted_pressures)
        signal_score = min(40.0, avg_pressure / 4.0 * 40.0)
    else:
        signal_score = 0.0

    urgency = round(min(100.0, deadline_score + signal_score), 1)

    if urgency >= 90:
        severity = "critical"
    elif urgency >= 70:
        severity = "high"
    elif urgency >= 50:
        severity = "medium"
    elif urgency >= 25:
        severity = "low"
    else:
        severity = "none"

    return UrgencyResult(
        urgency_score=urgency,
        deadline_score=round(deadline_score, 1),
        signal_score=round(signal_score, 1),
        severity=severity,
        lead_time_h=round(lead_time_h, 2) if lead_time_h is not None else None,
        signals=signal_breakdown,
    )
