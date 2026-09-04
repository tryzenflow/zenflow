"""Numpy glue and request guards shared by the route handlers.

Kept out of :mod:`src.api` so that module holds only the FastAPI ``app`` and the
three route handlers.
"""

from __future__ import annotations

import math
from collections.abc import Iterable

import numpy as np
from fastapi import HTTPException

from src.schemas import ArmState


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

    An empty ``A`` becomes ``ridge·I``; an empty ``b`` becomes the zero vector.
    """
    if st.A:
        a: np.ndarray = np.asarray(st.A, dtype=np.float64).reshape(d, d)
    else:
        a = ridge * np.identity(d)
    if st.b:
        b: np.ndarray = np.asarray(st.b, dtype=np.float64)
    else:
        b = np.zeros(d)
    return a, b
