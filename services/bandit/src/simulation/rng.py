"""Seeded random streams: one independent generator per (seed, purpose, key).

Every consumer asks for its own stream, so adding a draw in one place never
shifts another (and paired policy worlds can share a stream on purpose).
"""

from __future__ import annotations

import numpy as np

_PURPOSES = {
    "archetype": 0,
    "profile": 1,
    "calendar": 2,
    "tasks": 3,
    "drift": 4,
    "reaction": 5,
    "tiebreak": 6,
    "bootstrap": 7,
    "daytime": 8,
}


def stream(seed: int, purpose: str, *key: int) -> np.random.Generator:
    """Generator for ``(seed, purpose, *key)``; same arguments, same stream."""
    ss = np.random.SeedSequence(seed, spawn_key=(_PURPOSES[purpose], *key))
    return np.random.default_rng(ss)
