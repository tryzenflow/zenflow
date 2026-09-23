"""Disjoint LinUCB (Li et al., 2010, Algorithm 1).

This module is used two different ways:

* :class:`LinUCB` is a *stateful* multi-armed bandit — it owns every arm's
  ridge-regression state and lazily creates arms on first sight. It backs the
  offline replay evaluator (:mod:`src.evaluators.policy`), which plays one
  bandit forward across a whole logged event history.
* :func:`score` and :func:`update` are *stateless* functions over caller-owned
  ``(A, b)`` arrays. They back the request-scoped HTTP surface
  (:mod:`src.api`, :mod:`src.policies.linucb`), where the NestJS backend
  persists each arm's state between requests and hands it back on the next
  one — this service never remembers an arm across requests.

Both call styles share the same shapes:

d : int
    Feature dimension (the length of one context vector). Fixed per model
    instance, or per request — never inferred implicitly.
A : ndarray of shape (d, d)
    Ridge design matrix for one arm: ``ridge * I + sum(x xᵀ)`` over every
    context the arm has been played on.
b : ndarray of shape (d,)
    Ridge response vector for one arm: ``sum(payoff * x)``.
x : ndarray of shape (d,) or (n, d)
    One context vector, or a batch of ``n`` of them sharing the same feature
    space (e.g. one row per candidate placement day).
theta : ndarray of shape (d,)
    Point estimate ``A^-1 b`` — an arm's current linear coefficients.

The model is a reproducible function of ``(inputs + seed)``: the only source
of randomness is uniform tie-breaking in :meth:`LinUCB.select_arm`, which
draws from an injected ``random.Random`` rather than the module-global RNG.
"""

from __future__ import annotations

import math
import random

import numpy as np

from src.models.schemas import ArmParams


def score(
    a: np.ndarray, b: np.ndarray, x: np.ndarray, alpha: float
) -> float | np.ndarray:
    """Upper-confidence-bound score(s) for one arm's ``(A, b)`` state.

    Parameters
    ----------
    a : ndarray of shape (d, d)
        The arm's ridge design matrix.
    b : ndarray of shape (d,)
        The arm's ridge response vector.
    x : ndarray of shape (d,) or (n, d)
        A single context, or a batch of ``n`` contexts to score against the
        same arm state. ``A`` is inverted once either way.
    alpha : float
        Exploration width; the confidence bonus is ``alpha * sqrt(xᵀA⁻¹x)``.

    Returns
    -------
    float or ndarray of shape (n,)
        ``theta_hat @ x + alpha * sqrt(x @ A^-1 @ x)`` with
        ``theta_hat = A^-1 b``. A scalar when ``x`` is 1-D, an ``(n,)`` array
        when ``x`` is 2-D — so a caller scoring many candidate days against
        one arm inverts ``A`` only once.
    """
    a_inv: np.ndarray = np.linalg.inv(a)
    theta_hat: np.ndarray = a_inv @ b
    x_arr = np.asarray(x, dtype=np.float64)
    single = x_arr.ndim == 1
    x2 = x_arr[np.newaxis, :] if single else x_arr
    uncertainty = np.sqrt(np.maximum(((x2 @ a_inv) * x2).sum(axis=1), 0.0))
    result: np.ndarray = x2 @ theta_hat + alpha * uncertainty
    return float(result[0]) if single else result


def update(
    a: np.ndarray, b: np.ndarray, x: np.ndarray, reward: float
) -> tuple[np.ndarray, np.ndarray]:
    """Fold one ``(context, reward)`` pair into ``(A, b)`` without mutating them.

    Parameters
    ----------
    a : ndarray of shape (d, d)
    b : ndarray of shape (d,)
    x : ndarray of shape (d,)
        The context played.
    reward : float
        The observed payoff.

    Returns
    -------
    tuple of (ndarray of shape (d, d), ndarray of shape (d,))
        ``(a + x @ xᵀ, b + reward * x)`` as new arrays — the HTTP
        ``/v1/update`` handler needs the new state to return, not a mutation
        of its input.
    """
    new_a: np.ndarray = a + np.outer(x, x)
    new_b: np.ndarray = b + reward * x
    return new_a, new_b


class LinUCB:
    """Stateful disjoint LinUCB bandit with lazily-created arms.

    Parameters
    ----------
    n_features : int
        Context dimension ``d``. Every ``x`` passed in must have shape
        ``(d,)``.
    alpha : float
        Exploration width; see :func:`score`.
    ridge : float, default=1.0
        Regularization ``lambda``, folded in once per arm by seeding
        ``A = lambda * I`` (:meth:`ArmParams.cold`). Must be > 0, or ``A`` is
        singular until an arm has been observed ``d`` times.
    rng : random.Random, optional
        Injected RNG, used only to break score ties. Defaults to a
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
        """Arms seen so far, in a stable (sorted) order.

        Returns
        -------
        tuple[str, ...]
        """
        return tuple(sorted(self._arms))

    def select_arm(self, features: dict[str, np.ndarray]) -> str:
        """Return the arm with the highest upper confidence bound.

        Parameters
        ----------
        features : dict[str, ndarray of shape (d,)]
            Context vector per candidate arm. Under the disjoint model every
            arm normally shares the same ``x``.

        Returns
        -------
        str
            The id of the chosen arm.

        Raises
        ------
        ValueError
            If ``features`` is empty or any vector is mis-shaped.
        """
        if not features:
            raise ValueError("select_arm requires at least one candidate arm")

        scores: dict[str, float] = {}
        for arm, x in features.items():
            vector = self._validated(x)
            params = self._get_or_create_arm(arm)
            scores[arm] = float(score(params.A, params.b, vector, self._alpha))

        return self._argmax(scores)

    def update(self, arm: str, x: np.ndarray, payoff: float) -> None:
        """Apply a reward signal for ``arm`` under context ``x``.

        Parameters
        ----------
        arm : str
            The arm played. Safe to call for an arm never returned by
            :meth:`select_arm` — the normal case in offline replay, where the
            logged arm was chosen by a different policy.
        x : ndarray of shape (d,)
        payoff : float
        """
        self._get_or_create_arm(arm).add_observation(self._validated(x), payoff)

    def theta(self, arm: str) -> np.ndarray:
        """Current coefficient estimate ``A^-1 b`` for ``arm``.

        Returns
        -------
        ndarray of shape (d,)
        """
        params = self._get_or_create_arm(arm)
        estimate: np.ndarray = params.a_inv @ params.b
        return estimate

    def _get_or_create_arm(self, arm: str) -> ArmParams:
        """Return the arm's state, creating it at the ridge prior if unseen."""
        params = self._arms.get(arm)
        if params is None:
            params = ArmParams.cold(self._n_features, self._ridge)
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
            for arm, s in scores.items()
            if math.isclose(s, best, rel_tol=self._TIE_TOL, abs_tol=self._TIE_TOL)
        )
        return tied[0] if len(tied) == 1 else self._rng.choice(tied)
