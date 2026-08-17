"""A single logged bandit interaction."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True, slots=True)
class Event:
    """One row of the logged interaction stream.

    Attributes:
        x: Context vector of shape ``(d,)``, shared across arms (disjoint model).
        arm: The arm the *logging* policy played — not necessarily the one the
            policy under evaluation would pick.
        payoff: Observed reward for ``arm`` under ``x``.
    """

    x: np.ndarray
    arm: str
    payoff: float
