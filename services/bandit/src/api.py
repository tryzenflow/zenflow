"""FastAPI HTTP surface over the disjoint LinUCB model (:mod:`src.models.linucb`).

The service is **stateless**: every request carries the per-arm ridge-regression
state ``(A, b)``; ``POST /update`` returns the new state for the NestJS backend
to persist (ADR-0001 §6.1). All scoring / update math is delegated to
:func:`src.models.linucb.score` and :func:`src.models.linucb.update`, which
mirror the model core exactly (Li et al., 2010, Algorithm 1):

* score  ``θ̂ᵀx + α·√(xᵀA⁻¹x)``  with ``θ̂ = A⁻¹b``
* update ``A += xxᵀ``, ``b += reward·x``

Request/response models live in :mod:`src.schemas`; the numpy glue and 422
guards in :mod:`src.serialization`. This module is only the app and its routes.
"""

from __future__ import annotations

import math
import time

import numpy as np
from fastapi import FastAPI

from src.models.linucb import score, update
from src.otel import setup_otel
from src.schemas import (
    ARM_IDS,
    ArmId,
    PredictRequest,
    PredictResponse,
    UpdateRequest,
    UpdateResponse,
)
from src.serialization import all_finite, hydrate, require_422
from src.telemetry import (
    cold_arms,
    predict_duration,
    singular_matrix,
    tracer,
    update_duration,
)

app = FastAPI(title="Zenflow Bandit Service", version="0.1.0")
setup_otel(app)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/predict")
def predict(request: PredictRequest) -> PredictResponse:
    require_422(
        math.isfinite(request.alpha) and request.alpha >= 0.0, "alpha must be >= 0"
    )
    require_422(
        math.isfinite(request.ridge) and request.ridge > 0.0, "ridge must be > 0"
    )
    for ctx in request.contexts:
        require_422(all_finite(ctx.x), f"context x for {ctx.day!r} must be finite")
    for arm in ARM_IDS:
        st = request.state[arm]
        require_422(
            all_finite(st.A) and all_finite(st.b), f"state for {arm} must be finite"
        )

    d = len(request.contexts[0].x)
    started = time.perf_counter()

    # Hydrate each arm once. A fully-empty state is "cold" -> fixed 0.0 score.
    is_cold: dict[ArmId, bool] = {}
    hydrated: dict[ArmId, tuple[np.ndarray, np.ndarray]] = {}
    for arm in ARM_IDS:
        st = request.state[arm]
        cold = not st.A and not st.b
        is_cold[arm] = cold
        if not cold:
            hydrated[arm] = hydrate(st, d, request.ridge)

    cold_count = sum(is_cold.values())

    with tracer.start_as_current_span(
        "linucb.score_all",
        attributes={
            "linucb.days": len(request.contexts),
            "linucb.dim": d,
            "linucb.cold_arms": cold_count,
        },
    ):
        scores: dict[str, dict[ArmId, float]] = {}
        for ctx in request.contexts:
            x: np.ndarray = np.asarray(ctx.x, dtype=np.float64)
            row: dict[ArmId, float] = {}
            for arm in ARM_IDS:
                if is_cold[arm]:
                    row[arm] = 0.0
                else:
                    a, b = hydrated[arm]
                    try:
                        row[arm] = score(a, b, x, request.alpha)
                    except np.linalg.LinAlgError:
                        singular_matrix.add(1, {"op": "predict"})
                        raise
            scores[ctx.day] = row

    predict_duration.record(time.perf_counter() - started)
    cold_arms.record(cold_count)
    return PredictResponse(scores=scores)


@app.post("/update")
def update_arm(request: UpdateRequest) -> UpdateResponse:
    require_422(
        math.isfinite(request.ridge) and request.ridge > 0.0, "ridge must be > 0"
    )
    require_422(math.isfinite(request.reward), "reward must be finite")
    require_422(all_finite(request.x), "x must be finite")
    require_422(
        all_finite(request.state.A) and all_finite(request.state.b),
        "state must be finite",
    )

    started = time.perf_counter()
    d = len(request.x)
    x: np.ndarray = np.asarray(request.x, dtype=np.float64)
    a, b = hydrate(request.state, d, request.ridge)
    new_a, new_b = update(a, b, x, request.reward)
    update_duration.record(time.perf_counter() - started)
    return UpdateResponse(A=new_a.reshape(-1).tolist(), b=new_b.tolist())
