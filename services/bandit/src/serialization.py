"""Numpy glue and request guards shared by the route handlers.

Kept out of :mod:`src.api` so that module holds only the FastAPI ``app`` and the
three route handlers.
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Mapping

import numpy as np
from fastapi import HTTPException

from src.models.schemas import ArmParams
from src.schemas import ARM_IDS, ArmId, ArmState


def all_finite(values: Iterable[float]) -> bool:
    """Return ``True`` iff every value is a finite float (no ``inf`` / ``nan``)."""
    return all(math.isfinite(v) for v in values)


def require_422(ok: bool, message: str) -> None:
    """Raise ``HTTPException(status_code=422, detail=message)`` when ``ok`` is false.

    Guards catch non-finite inputs that Pydantic lets through (plain ``float``
    accepts ``inf`` / ``nan``) but that would 500 on response serialization
    (Starlette's ``JSONResponse`` uses ``allow_nan=False``).
    """
    if not ok:
        raise HTTPException(status_code=422, detail=message)


def hydrate(st: ArmState, d: int, ridge: float) -> tuple[np.ndarray, np.ndarray]:
    """Materialize an arm's ``(A, b)`` numpy arrays, falling back to the ridge prior.

    A fully empty state (no ``A`` and no ``b``) is seeded at the ridge prior
    via :meth:`src.models.schemas.ArmParams.cold` — ``A = ridge * I``. A
    partially empty state (only one of the two missing) fills just that half
    the same way, without going through ``ArmParams``.

    Parameters
    ----------
    st : ArmState
        Wire state for one arm.
    d : int
        Feature dimension.
    ridge : float
        Regularization ``lambda``.

    Returns
    -------
    tuple of (ndarray of shape (d, d), ndarray of shape (d,))
        ``(A, b)``.
    """
    if not st.A and not st.b:
        cold = ArmParams.cold(d, ridge)
        return cold.A, cold.b
    a: np.ndarray = (
        np.asarray(st.A, dtype=np.float64).reshape(d, d)
        if st.A
        else ridge * np.identity(d)
    )
    b: np.ndarray = np.asarray(st.b, dtype=np.float64) if st.b else np.zeros(d)
    return a, b


def is_cold(st: ArmState | None) -> bool:
    """``True`` for an arm with no observations yet (no ``A`` and no ``b``)."""
    return st is None or (not st.A and not st.b)


def hydrate_arms(
    state: Mapping[ArmId, ArmState], d: int, ridge: float
) -> dict[ArmId, ArmParams]:
    """Hydrate every one of the 5 canonical arms into :class:`ArmParams`.

    A cold arm (missing, or no ``A`` and no ``b``) is seeded at the ridge prior
    ``A = ridge * I, b = 0``, so it scores its full exploration bonus
    ``alpha * sqrt(xᵀx / ridge)`` -- standard LinUCB optimism. (It used to be
    pinned at ``0.0``, which let the first rewarded arm win forever: a warm arm's
    bonus kept it above 0 even after the user moved its placements.)

    Parameters
    ----------
    state : Mapping[ArmId, ArmState]
        Per-arm wire state.
    d : int
        Feature dimension.
    ridge : float
        Regularization ``lambda``.

    Returns
    -------
    dict[ArmId, ArmParams]
    """
    out: dict[ArmId, ArmParams] = {}
    for arm in ARM_IDS:
        st = state.get(arm)
        if is_cold(st):
            out[arm] = ArmParams.cold(d, ridge)
            continue
        assert st is not None
        a, b = hydrate(st, d, ridge)
        out[arm] = ArmParams(a, b)
    return out
