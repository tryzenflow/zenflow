"""Policies under evaluation.

A policy picks an arm from a context and absorbs feedback incrementally. State
is carried by the policy itself rather than re-derived from the event history on
every call, which keeps replay linear in the number of events instead of
quadratic — and lets a genuinely stateful learner like :class:`LinUCB` plug in.
"""

from __future__ import annotations

import random
from abc import ABC, abstractmethod
from collections.abc import Iterable
from typing import override

import numpy as np

from ..models.linucb import LinUCB
from .event import Event


class Policy(ABC):
    """Maps a context to an arm, optionally learning from retained events."""

    @abstractmethod
    def select(self, x: np.ndarray) -> str:
        """Return the arm to play for context ``x``."""
        raise NotImplementedError

    def update(self, event: Event) -> None:
        """Absorb an event the evaluator retained. No-op for stateless policies."""
        return None


class RandomPolicy(Policy):
    """Uniformly random baseline over a fixed arm set.

    The arm set is a property of the problem, so it is supplied up front rather
    than inferred from the events seen so far (which would leave the first call
    with nothing to choose from).
    """

    def __init__(self, arms: Iterable[str], rng: random.Random | None = None) -> None:
        self._arms = tuple(sorted(set(arms)))
        if not self._arms:
            raise ValueError("RandomPolicy requires at least one arm")
        self._rng = rng if rng is not None else random.Random(0)

    @override
    def select(self, x: np.ndarray) -> str:
        return self._rng.choice(self._arms)


class LinUCBPolicy(Policy):
    """Adapter exposing :class:`LinUCB` through the :class:`Policy` interface.

    Under the disjoint model every arm scores the same context vector, so the
    per-arm feature map is just ``x`` broadcast across the arm set.
    """

    def __init__(
        self,
        arms: Iterable[str],
        n_features: int,
        alpha: float,
        ridge: float = 1.0,
        rng: random.Random | None = None,
    ) -> None:
        self._arms = tuple(sorted(set(arms)))
        if not self._arms:
            raise ValueError("LinUCBPolicy requires at least one arm")
        self._model = LinUCB(n_features, alpha, ridge=ridge, rng=rng)

    @property
    def model(self) -> LinUCB:
        return self._model

    @override
    def select(self, x: np.ndarray) -> str:
        return self._model.select_arm({arm: x for arm in self._arms})

    @override
    def update(self, event: Event) -> None:
        self._model.update(event.arm, event.x, event.payoff)
