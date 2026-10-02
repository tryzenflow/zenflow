"""Warm-start prior for the simulated LinUCB (prototype, simulator only, issue #60).

Each arm's ridge state starts at ``A = ridge * I + n0 * sum_c w_c x_c x_c^T`` and
``b = n0 * r_arm * sum_c w_c x_c`` instead of ``(ridge * I, 0)``, i.e. ``n0``
pseudo-observations spread over a weekday and a weekend *typical* context
``x_c`` (weights ``w_c`` = 5/7 and 2/7) with a pseudo-reward ``r_arm`` that
depends on the mode:

``pref``       mean of the default preference matrix over the arm's band
               (0 .. 0.6; real rewards are +1 retained, negative graded on a move);
``pref_norm``  the same, rescaled so the best band has reward 1;
``pref_hi``    ``0.5 + 0.5 * pref_norm``: every arm starts at a middling reward and
               the preference only tilts it (closer to the +1 retained scale);
``flat``       reward 0 for every arm: only ``A`` grows, so the exploration bonus
               shrinks and nothing is preferred (ablation).

The data overrides the prior at rate ``1 / (n0 + n_obs)``. ``n0 = 0`` (or no
spec at all) is exactly the production cold start. A pure function: no I/O,
clock or randomness. Nothing here is imported by the service.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from src.core.arms import ARM_BANDS
from src.core.constants import FEATURE_DIM
from src.core.context_vector import build_context_vector
from src.core.preference import default_preference_matrix

PRIOR_MODES = ("pref", "pref_norm", "pref_hi", "flat")
WEEKDAY_SHARE = 5 / 7

Prior = tuple[dict[str, NDArray[np.float64]], dict[str, NDArray[np.float64]]]


@dataclass(frozen=True)
class PriorSpec:
    mode: str = "pref"
    n0: float = 0.0

    def __post_init__(self) -> None:
        if self.mode not in PRIOR_MODES:
            raise ValueError(f"unknown prior mode {self.mode!r}; use {PRIOR_MODES}")
        if self.n0 < 0:
            raise ValueError(f"n0 must be >= 0, got {self.n0}")

    @property
    def active(self) -> bool:
        return self.n0 > 0

    @property
    def tag(self) -> str:
        return f"{self.mode}{self.n0:g}"


def band_pref_means() -> dict[str, float]:
    """Mean default preference (over weekdays and the band's minutes) per arm."""
    hourly = default_preference_matrix().reshape(7, -1).mean(axis=0)
    out: dict[str, float] = {}
    for arm, lo, hi in ARM_BANDS:
        out[arm] = float(np.mean([hourly[m // 60] for m in range(lo, hi)]))
    return out


def typical_contexts() -> list[tuple[float, NDArray[np.float64]]]:
    """``(weight, x)`` of a typical weekday and weekend candidate day."""

    def ctx(iso_weekday: int) -> NDArray[np.float64]:
        return build_context_vector(
            remaining_days_until_deadline=7,
            duration_minutes=90,
            candidate_iso_weekday=iso_weekday,
            candidate_days_from_now=3,
            workload_by_type={
                "LECTURE": {"hours": 3.0},
                "TASK": {"hours": 2.0},
            },
        )

    return [(WEEKDAY_SHARE, ctx(3)), (1 - WEEKDAY_SHARE, ctx(6))]


def prior_rewards(mode: str) -> dict[str, float]:
    means = band_pref_means()
    if mode == "flat":
        return dict.fromkeys(means, 0.0)
    if mode in ("pref_norm", "pref_hi"):
        top = max(means.values())
        scaled = {a: v / top for a, v in means.items()}
        if mode == "pref_hi":
            return {a: 0.5 + 0.5 * v for a, v in scaled.items()}
        return scaled
    return means


def warm_state(spec: PriorSpec, ridge: float) -> Prior:
    """Per-arm ``(A, b)`` at the prior (``ridge * I, 0`` when the spec is off)."""
    rewards = prior_rewards(spec.mode)
    ctxs = typical_contexts()
    gram = np.sum([w * np.outer(x, x) for w, x in ctxs], axis=0)
    xsum = np.sum([w * x for w, x in ctxs], axis=0)
    base = ridge * np.identity(FEATURE_DIM) + spec.n0 * gram
    a = {arm: base.copy() for arm, _, _ in ARM_BANDS}
    b = {arm: spec.n0 * rewards[arm] * xsum for arm, _, _ in ARM_BANDS}
    return a, b
