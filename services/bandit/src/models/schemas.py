"""Mutable per-arm state shared by every LinUCB consumer in this service."""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np


@dataclass
class ArmParams:
    """Ridge-regression state for a single arm.

    Parameters
    ----------
    A : ndarray of shape (d, d)
        Design matrix ``ridge * I + sum(x xᵀ)`` over every context this arm
        has been played on.
    b : ndarray of shape (d,)
        Response vector ``sum(payoff * x)``.

    Notes
    -----
    ``a_inv`` caches ``inv(A)`` and is invalidated on every observation, so
    the inverse costs at most one ``O(d³)`` factorization per arm per round —
    and nothing at all in rounds where the arm was not updated.
    """

    A: np.ndarray
    b: np.ndarray
    _a_inv: np.ndarray | None = field(default=None, repr=False)

    @classmethod
    def cold(cls, d: int, ridge: float) -> ArmParams:
        """A brand-new arm at the ridge prior, with no observations yet.

        Parameters
        ----------
        d : int
            Feature dimension.
        ridge : float
            Ridge regularization ``lambda``; must be > 0 so ``A`` starts
            invertible.

        Returns
        -------
        ArmParams
            ``A = ridge * I_d``, ``b = 0`` — so ``theta_hat = A^-1 b = 0``
            until the arm is observed.
        """
        return cls(ridge * np.identity(d), np.zeros(d))

    @property
    def a_inv(self) -> np.ndarray:
        """``inv(A)``, computed lazily and cached until the next observation.

        Returns
        -------
        ndarray of shape (d, d)
        """
        if self._a_inv is None:
            self._a_inv = np.linalg.inv(self.A)
        return self._a_inv

    def add_observation(self, x: np.ndarray, payoff: float) -> None:
        """Fold one ``(context, payoff)`` pair into this arm's statistics, in place.

        Parameters
        ----------
        x : ndarray of shape (d,)
        payoff : float
        """
        self.A += np.outer(x, x)
        self.b += payoff * x
        self._a_inv = None

    def to_lists(self) -> tuple[list[float], list[float]]:
        """``(A, b)`` as flat/1-D Python lists (row-major ``A``) for a JSON response."""
        return self.A.reshape(-1).tolist(), self.b.tolist()
