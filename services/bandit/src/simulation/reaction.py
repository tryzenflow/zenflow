"""How a student reacts to a proposal: keep it (RETAINED) or drag it (MOVE).

The student perceives each slot's utility with noise. They move a proposal to
the best-looking free slot *on the same day* when the perceived gain beats a
threshold plus an inertia cost proportional to the drag distance, and they
actually bother only with probability ``p_edit``. The random draws are keyed by
(student, task, member), so both policy worlds face identical luck.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from src.core.constants import DAY_MS, MOVE_REWARD_SCALE_MINUTES, SLOT_MS

from .archetypes import StudentProfile
from .rng import stream

SLOTS_PER_DAY = DAY_MS // SLOT_MS


@dataclass(frozen=True)
class ReactionDraws:
    eps_prop: float
    u_act: float
    eps_slots: NDArray[np.float64]  # one noise value per 15-min slot of the day


def draw_reaction(
    seed: int, student_id: int, task_id: int, member: int
) -> ReactionDraws:
    rng = stream(seed, "reaction", student_id, task_id, member)
    return ReactionDraws(
        eps_prop=float(rng.standard_normal()),
        u_act=float(rng.random()),
        eps_slots=rng.standard_normal(SLOTS_PER_DAY),
    )


def decide(
    p: StudentProfile,
    draws: ReactionDraws,
    proposed_ms: int,
    proposed_utility: float,
    cand_starts_ms: NDArray[np.int64],
    cand_utilities: NDArray[np.float64],
) -> int | None:
    """New start if the student drags the proposal, else ``None`` (RETAINED)."""
    if cand_starts_ms.size == 0:
        return None
    slot_idx = (cand_starts_ms % DAY_MS) // SLOT_MS
    perceived = cand_utilities + p.noise_sd * draws.eps_slots[slot_idx]
    best = int(np.argmax(perceived))
    target = int(cand_starts_ms[best])
    if target == proposed_ms:
        return None
    gain = float(perceived[best]) - (proposed_utility + p.noise_sd * draws.eps_prop)
    drag_min = abs(target - proposed_ms) / 60_000
    needed = p.threshold + p.inertia * drag_min / MOVE_REWARD_SCALE_MINUTES
    if gain > needed and draws.u_act < p.p_edit:
        return target
    return None
