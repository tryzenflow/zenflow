"""LinUCB placement policy: slot-first scan wired to :mod:`src.models.linucb`."""

from __future__ import annotations

import math
from collections.abc import Sequence

import numpy as np
from numpy.typing import NDArray

from src.core import constants as consts
from src.core.linucb_best_slot import LinucbCandidateDay, best_linucb_slot
from src.core.slot import Intervals
from src.models.linucb import score as linucb_score
from src.schemas import ARM_IDS, ArmId
from src.schemas_place import (
    BanditWire,
    LinucbPick,
    PlacementDay,
    PlacementMember,
    Weights,
)
from src.serialization import hydrate_arms


class LinucbPolicy:
    """Slot-first LinUCB search (issue #62 A) over one request's bandit state.

    Hydrates every arm's ``(A, b)`` once per request via
    :func:`src.serialization.hydrate_arms` — an arm with a fully empty state
    (no ``A`` and no ``b``) is "cold" and fixed at score ``0.0`` by contract;
    every other arm is seeded at the ridge prior (``A = ridge * I``) and
    scored through :func:`src.models.linucb.score`.
    """

    def __init__(
        self, bandit: BanditWire | None, matrix: Sequence[float], timezone: str
    ) -> None:
        self.matrix = matrix
        self.tz = timezone
        self.alpha = bandit.alpha if bandit is not None else 0.0
        self._arms = (
            hydrate_arms(bandit.state, consts.FEATURE_DIM, bandit.ridge)
            if bandit is not None
            else {}
        )

    @property
    def enabled(self) -> bool:
        """``True`` iff the request carried bandit state at all."""
        return bool(self._arms)

    def arm_scores(
        self, vectors_by_day: dict[str, NDArray[np.float64]]
    ) -> dict[str, dict[ArmId, float]]:
        """Score every arm against every day's context vector.

        Parameters
        ----------
        vectors_by_day : dict[str, ndarray of shape (d,)]
            One context vector per candidate ``dayStr``.

        Returns
        -------
        dict[str, dict[ArmId, float]]
            ``{day_str: {arm: score}}`` — always all 5 arms, per contract.
        """
        keys = list(vectors_by_day)
        x = (
            np.stack([vectors_by_day[k] for k in keys])
            if keys
            else np.empty((0, consts.FEATURE_DIM))
        )
        per_arm: dict[ArmId, NDArray[np.float64]] = {}
        for arm in ARM_IDS:
            params = self._arms.get(arm)
            if params is None:
                per_arm[arm] = np.zeros(x.shape[0])
                continue
            # x is always 2-D here (a stacked batch), so this is always an array.
            per_arm[arm] = np.asarray(
                linucb_score(params.A, params.b, x, self.alpha), dtype=np.float64
            )
        return {
            k: {a: float(per_arm[a][i]) for a in ARM_IDS} for i, k in enumerate(keys)
        }

    def best_slot(
        self,
        member: PlacementMember,
        days: list[PlacementDay],
        occupied_by_day: dict[str, Intervals],
        vectors_by_day: dict[str, NDArray[np.float64]],
        arm_scores: dict[str, dict[ArmId, float]],
        extra: Intervals,
        next_ms: int,
        deadline_ms: int,
        observation_count: float,
    ) -> LinucbPick | None:
        if not self.enabled or not days:
            return None
        cand = [
            LinucbCandidateDay(
                day_str=d.day_str,
                day_start_ms=d.day_start_ms,
                day_end_ms=d.day_end_ms,
                occupied=occupied_by_day[d.day_str],
                vector=vectors_by_day[d.day_str].tolist(),
                arm_scores=arm_scores[d.day_str],
            )
            for d in days
        ]
        best = best_linucb_slot(
            cand,
            member.duration_minutes,
            self.tz,
            self.matrix,
            next_ms,
            deadline_ms,
            extra,
            member.prev_start_ms,
            observation_count,
        )
        if best is None or not math.isfinite(best.score):
            return None
        arm: ArmId = next(a for a in ARM_IDS if a == best.arm)
        return LinucbPick(
            start_ms=best.start_ms,
            score=best.score,
            selected_arm=arm,
            feature_vector=best.vector,
            weights=Weights(wL=best.weights.wL, wP=best.weights.wP),
        )
