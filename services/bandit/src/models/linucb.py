"""Disjoint LinUCB (Li et al., 2010, Algorithm 1).

Each arm keeps its own ridge-regression state over a *shared* context vector.
The model is a reproducible function of ``(inputs + seed)``: the only source of
randomness is uniform tie-breaking, which draws from an injected
``random.Random`` rather than the module-global RNG.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass, field

import numpy as np


@dataclass
class ArmParams:
    """Ridge-regression state for a single arm.

    ``A`` is the ``(d, d)`` design matrix ``ridge * I + sum(x xᵀ)`` and ``b`` the
    ``(d,)`` response vector ``sum(payoff * x)``. ``_a_inv`` caches ``inv(A)``
    and is invalidated on every observation, so the inverse costs at most one
    ``O(d³)`` factorization per arm per round — and nothing at all in rounds
    where the arm was not updated.
    """

    A: np.ndarray
    b: np.ndarray
    _a_inv: np.ndarray | None = field(default=None, repr=False)

    @property
    def a_inv(self) -> np.ndarray:
        """``inv(A)``, computed lazily and cached until the next observation."""
        if self._a_inv is None:
            self._a_inv = np.linalg.inv(self.A)
        return self._a_inv

    def add_observation(self, x: np.ndarray, payoff: float) -> None:
        """Fold one ``(context, payoff)`` pair into this arm's statistics."""
        self.A += np.outer(x, x)
        self.b += payoff * x
        self._a_inv = None


def score(a: np.ndarray, b: np.ndarray, x: np.ndarray, alpha: float) -> float:
    """UCB score for a single arm given its ``(A, b)`` state and context ``x``.

    ``θ̂ᵀx + α·√(xᵀA⁻¹x)`` with ``θ̂ = A⁻¹b`` — the exact per-arm computation
    from :meth:`LinUCB.select_arm`, lifted out so a stateless HTTP layer can
    reuse it on caller-supplied ``(A, b)``. The caller owns shape agreement
    (``a`` is ``(d, d)``, ``b`` and ``x`` are ``(d,)``).
    """
    a_inv: np.ndarray = np.linalg.inv(a)
    theta_hat: np.ndarray = a_inv @ b
    expected_reward = float(theta_hat @ x)
    uncertainty = math.sqrt(max(float(x @ a_inv @ x), 0.0))
    return expected_reward + alpha * uncertainty


def update(
    a: np.ndarray, b: np.ndarray, x: np.ndarray, reward: float
) -> tuple[np.ndarray, np.ndarray]:
    """Fold one ``(context, reward)`` pair into ``(A, b)``.

    ``A + xxᵀ``, ``b + reward·x`` — the math from
    :meth:`ArmParams.add_observation`, returned as new arrays so the inputs are
    left untouched (the HTTP ``/update`` handler needs the new state to return,
    not a mutation).
    """
    new_a: np.ndarray = a + np.outer(x, x)
    new_b: np.ndarray = b + reward * x
    return new_a, new_b


class LinUCB:
    """Disjoint LinUCB with lazily-created arms.

    Args:
        n_features: Context dimension ``d``. Every ``x`` must have shape ``(d,)``.
        alpha: Exploration width; the confidence bonus is ``alpha * sqrt(xᵀ A⁻¹ x)``.
        ridge: Regularization ``lambda``, folded in once by seeding
            ``A = lambda * I``. Must be > 0, or ``A`` is singular until an arm
            has been observed ``d`` times.
        rng: Injected RNG, used only to break score ties. Defaults to a
            deterministically seeded generator so runs are reproducible.
    """

    #: Scores within this relative/absolute tolerance count as tied.
    _TIE_TOL = 1e-12

    def __init__(
        self,
        n_features: int,
        alpha: float,
        ridge: float = 1.0,
        rng: random.Random | None = None,
    ) -> None:
        if n_features <= 0:
            raise ValueError(f"n_features must be positive, got {n_features}")
        if alpha < 0:
            raise ValueError(f"alpha must be non-negative, got {alpha}")
        if ridge <= 0:
            raise ValueError(f"ridge must be positive, got {ridge}")

        self._n_features = n_features
        self._alpha = alpha
        self._ridge = ridge
        self._rng = rng if rng is not None else random.Random(0)
        self._arms: dict[str, ArmParams] = {}

    @property
    def n_features(self) -> int:
        return self._n_features

    @property
    def arms(self) -> tuple[str, ...]:
        """Arms seen so far, in a stable (sorted) order."""
        return tuple(sorted(self._arms))

    def select_arm(self, features: dict[str, np.ndarray]) -> str:
        """Return the arm with the highest upper confidence bound.

        Args:
            features: Context vector per candidate arm. Under the disjoint model
                every arm normally shares the same ``x``.

        Raises:
            ValueError: If ``features`` is empty or any vector is mis-shaped.
        """
        if not features:
            raise ValueError("select_arm requires at least one candidate arm")

        scores: dict[str, float] = {}
        for arm, x in features.items():
            vector = self._validated(x)
            params = self._get_or_create_arm(arm)
            a_inv = params.a_inv

            theta_hat = a_inv @ params.b
            expected_reward = float(theta_hat @ vector)
            uncertainty = math.sqrt(max(float(vector @ a_inv @ vector), 0.0))

            scores[arm] = expected_reward + self._alpha * uncertainty

        return self._argmax(scores)

    def update(self, arm: str, x: np.ndarray, payoff: float) -> None:
        """Apply a reward signal for ``arm`` under context ``x``.

        Safe to call for an arm never returned by :meth:`select_arm` — that is
        the normal case in offline replay, where the logged arm was chosen by a
        different policy.
        """
        self._get_or_create_arm(arm).add_observation(self._validated(x), payoff)

    def theta(self, arm: str) -> np.ndarray:
        """Current coefficient estimate ``A⁻¹ b`` for ``arm``."""
        params = self._get_or_create_arm(arm)
        estimate: np.ndarray = params.a_inv @ params.b
        return estimate

    def _get_or_create_arm(self, arm: str) -> ArmParams:
        """Return the arm's state, creating it at the ridge prior if unseen."""
        params = self._arms.get(arm)
        if params is None:
            params = ArmParams(
                A=self._ridge * np.identity(self._n_features),
                b=np.zeros(self._n_features),
            )
            self._arms[arm] = params
        return params

    def _validated(self, x: np.ndarray) -> np.ndarray:
        """Coerce ``x`` to a float64 ``(d,)`` vector, or raise."""
        vector = np.asarray(x, dtype=np.float64)
        if vector.shape != (self._n_features,):
            raise ValueError(
                f"expected feature vector of shape ({self._n_features},), "
                f"got {vector.shape}"
            )
        return vector

    def _argmax(self, scores: dict[str, float]) -> str:
        """Highest-scoring arm, ties broken uniformly at random.

        Every arm scores identically before any update, so deterministic
        tie-breaking would let dict insertion order pick the same arm forever.
        """
        best = max(scores.values())
        tied = sorted(
            arm
            for arm, score in scores.items()
            if math.isclose(score, best, rel_tol=self._TIE_TOL, abs_tol=self._TIE_TOL)
        )
        return tied[0] if len(tied) == 1 else self._rng.choice(tied)
