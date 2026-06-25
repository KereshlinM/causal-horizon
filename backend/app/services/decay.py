"""Fit causal decay curves from historical (observation, outcome) pairs."""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Entity, Observation, SignalDefinition


async def fit_signal_decay(db: AsyncSession, signal_id: int) -> dict[str, Any] | None:
    """
    Fit a decay curve for a signal from entities that have recorded outcomes.

    For each resolved entity with observations of this signal, compute
    lead_time = hours between observation and resolution, and record whether
    the outcome was negative (the thing we're trying to prevent).

    The decay curve models how predictive alarming signal values are at each
    lead time. We find the lead time bucket with the strongest predictive
    signal and fit lambda = 1 / peak_lead_time_h.

    Returns decay_params dict or None if insufficient data.
    """
    # Fetch resolved entities with at least one observation of this signal
    result = await db.execute(
        select(Entity).where(
            Entity.outcome.is_not(None),
            Entity.resolved_at.is_not(None),
        )
    )
    resolved_entities = result.scalars().all()

    if len(resolved_entities) < 5:
        return None

    # Compute global baseline for this signal across all observations
    obs_result = await db.execute(
        select(Observation).where(Observation.signal_id == signal_id)
    )
    all_obs = obs_result.scalars().all()
    if len(all_obs) < 10:
        return None

    all_values = np.array([o.value for o in all_obs], dtype=float)
    global_mean = float(np.mean(all_values))
    global_std = float(np.std(all_values))
    if global_std < 1e-9:
        return None

    # Collect (lead_time_h, z_score, is_negative_outcome) tuples
    data_points: list[tuple[float, float, bool]] = []

    for entity in resolved_entities:
        if entity.resolved_at is None:
            continue
        is_negative = entity.outcome == "negative"
        obs_result2 = await db.execute(
            select(Observation).where(
                Observation.entity_id == entity.id,
                Observation.signal_id == signal_id,
                Observation.observed_at < entity.resolved_at,
            )
        )
        entity_obs = obs_result2.scalars().all()
        for obs in entity_obs:
            lead_s = (entity.resolved_at - obs.observed_at).total_seconds()
            if lead_s <= 0:
                continue
            lead_h = lead_s / 3600
            z = (obs.value - global_mean) / global_std
            data_points.append((lead_h, z, is_negative))

    if len(data_points) < 10:
        return None

    # Group by lead_time buckets and compute mean |z| for negative vs positive outcomes
    buckets = [(0, 6), (6, 12), (12, 24), (24, 48), (48, 96), (96, 168), (168, float("inf"))]
    bucket_predictiveness: list[tuple[float, float]] = []  # (midpoint_h, predictiveness)

    for lo, hi in buckets:
        bucket_pts = [(z, neg) for (t, z, neg) in data_points if lo <= t < hi]
        if len(bucket_pts) < 3:
            continue
        neg_z = [abs(z) for z, neg in bucket_pts if neg]
        pos_z = [abs(z) for z, neg in bucket_pts if not neg]
        if not neg_z:
            continue
        neg_mean = float(np.mean(neg_z))
        pos_mean = float(np.mean(pos_z)) if pos_z else 0.0
        predictiveness = neg_mean - pos_mean
        mid = (lo + min(hi, lo * 3 + 24)) / 2
        bucket_predictiveness.append((mid, predictiveness))

    if not bucket_predictiveness:
        return None

    # Find the lead time where predictiveness peaks
    best_mid, best_pred = max(bucket_predictiveness, key=lambda x: x[1])

    if best_pred <= 0:
        return None

    # lambda = 1 / peak_lead_time (bell curve peaks at 1/lambda)
    peak_lead_time_h = max(1.0, best_mid)
    lam = 1.0 / peak_lead_time_h

    # Amplitude: normalize so causal_weight <= 1 at peak
    amplitude = min(1.0, best_pred / 2.0 + 0.5)

    return {
        "lambda": round(lam, 5),
        "amplitude": round(amplitude, 3),
        "peak_lead_time_h": round(peak_lead_time_h, 1),
        "n_samples": len(data_points),
    }


async def compute_signal_baseline(
    db: AsyncSession, signal_id: int
) -> tuple[float, float] | None:
    """Return (mean, std) across all observations of a signal, or None if insufficient."""
    result = await db.execute(
        select(Observation.value).where(Observation.signal_id == signal_id)
    )
    values = result.scalars().all()
    if len(values) < 2:
        return None
    arr = np.array(values, dtype=float)
    return float(np.mean(arr)), float(np.std(arr))
