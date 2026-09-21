"""Adaptive LinUCB/preference blend (port of ``adaptive-weights.ts``)."""

from __future__ import annotations

import math
from typing import NamedTuple

from .constants import (
    LINUCB_WEIGHT_COLD,
    LINUCB_WEIGHT_WARM,
    PREFERENCE_WEIGHT_COLD,
    PREFERENCE_WEIGHT_WARM,
    WEIGHT_WARMUP_OBSERVATIONS,
)


class SlotScoreWeights(NamedTuple):
    wL: float  # noqa: N815 - mirrors the TS field names
    wP: float  # noqa: N815


def adaptive_weights(observation_count: float) -> SlotScoreWeights:
    n = max(0.0, observation_count) if math.isfinite(observation_count) else 0.0
    t = min(1.0, n / WEIGHT_WARMUP_OBSERVATIONS)
    return SlotScoreWeights(
        LINUCB_WEIGHT_COLD * (1 - t) + LINUCB_WEIGHT_WARM * t,
        PREFERENCE_WEIGHT_COLD * (1 - t) + PREFERENCE_WEIGHT_WARM * t,
    )
