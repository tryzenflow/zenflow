"""Tracer + metric instruments for the LinUCB hot path.

``opentelemetry-api`` is always importable (it is a hard dependency); until
:func:`src.otel.setup_otel` installs real providers these handles are no-ops, so
call sites need no guards.
"""

from __future__ import annotations

from opentelemetry import metrics, trace

tracer = trace.get_tracer("zenflow-bandit")
_meter = metrics.get_meter("zenflow-bandit")

predict_duration = _meter.create_histogram(
    "bandit.predict.duration",
    unit="s",
    description="POST /predict LinUCB scoring wall-clock",
)
update_duration = _meter.create_histogram(
    "bandit.update.duration",
    unit="s",
    description="POST /update wall-clock",
)
singular_matrix = _meter.create_counter(
    "bandit.singular_matrix",
    description="A⁻¹ inversions that failed (singular design matrix), by op",
)
cold_arms = _meter.create_histogram(
    "bandit.predict.cold_arms",
    description="How many of the 5 arms were cold (fixed 0.0) on a /predict",
)
