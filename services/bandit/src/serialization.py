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


def hydrate_arms(
    state: Mapping[ArmId, ArmState], d: int, ridge: float
) -> dict[ArmId, ArmParams | None]:
    """Hydrate every one of the 5 canonical arms into :class:`ArmParams`.

    Parameters
    ----------
    state : Mapping[ArmId, ArmState]
        Per-arm wire state.
    d : int
        Feature dimension.
    ridge : float
        Regularization ``lambda``, passed through to :func:`hydrate` for an
        arm that is not fully cold.

    Returns
    -------
    dict[ArmId, ArmParams | None]
        ``None`` for an arm with a fully empty state (no ``A`` and no ``b``)
        — that arm is cold and fixed at score ``0.0`` by contract, never
        hydrated to the ridge prior.
    """
    out: dict[ArmId, ArmParams | None] = {}
    for arm in ARM_IDS:
        st = state.get(arm)
        if st is None or (not st.A and not st.b):
            out[arm] = None
            continue
        a, b = hydrate(st, d, ridge)
        out[arm] = ArmParams(a, b)
    return out
