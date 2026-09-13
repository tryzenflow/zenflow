"""OpenTelemetry + structured-logging bootstrap for the bandit service.

Traces and metrics go OTLP/HTTP to ``OTEL_EXPORTER_OTLP_ENDPOINT`` (default
``http://localhost:4318``); trace context propagates in from the NestJS backend
automatically via the ``traceparent`` header once the FastAPI app is
instrumented. Everything here is a no-op when ``OTEL_SDK_DISABLED=true`` or when
the ``opentelemetry`` packages are not installed, so ``pytest`` and a bare
``uvicorn`` run are unaffected.
"""

from __future__ import annotations

import json
import logging
import os
import sys
import time
from typing import Any

_SERVICE_NAME = os.environ.get("OTEL_SERVICE_NAME", "zenflow-bandit")

_configured = False


class _JsonFormatter(logging.Formatter):
    """One JSON object per line, `message` as the text key, trace ids folded in."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "time": time.strftime(
                "%Y-%m-%dT%H:%M:%S", time.gmtime(record.created)
            )
            + f".{int(record.msecs):03d}Z",
            "level": record.levelname.lower(),
            "component": record.name,
            "message": record.getMessage(),
            "service": _SERVICE_NAME,
        }
        for key in ("event", "operation", "trace_id", "span_id"):
            if (value := getattr(record, key, None)) is not None:
                payload[key] = value
        if record.exc_info:
            payload["err"] = self.formatException(record.exc_info)
        return json.dumps(payload)


def _configure_logging() -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(_JsonFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(os.environ.get("LOG_LEVEL", "INFO").upper())


def setup_otel(app: Any) -> None:
    """Install tracing + metrics + JSON logging. Safe to call once at startup."""
    global _configured
    if _configured:
        return
    _configured = True

    _configure_logging()

    if os.environ.get("OTEL_SDK_DISABLED", "").lower() == "true":
        logging.getLogger("otel").info(
            "OTel SDK disabled", extra={"event": "otel.disabled"}
        )
        return

    endpoint = os.environ.get(
        "OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318"
    )

    try:
        from opentelemetry import metrics, trace
        from opentelemetry.exporter.otlp.proto.http.metric_exporter import (
            OTLPMetricExporter,
        )
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import (
            OTLPSpanExporter,
        )
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
        from opentelemetry.sdk.metrics import MeterProvider
        from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
    except ImportError:  # packages not installed — stay a no-op
        logging.getLogger("otel").warning(
            "opentelemetry packages missing; telemetry disabled",
            extra={"event": "otel.import_failed"},
        )
        return

    resource = Resource.create(
        {
            "service.name": _SERVICE_NAME,
            "service.version": os.environ.get("SERVICE_VERSION", "0.1.0"),
            "deployment.environment.name": os.environ.get("ENV", "development"),
        }
    )

    provider = TracerProvider(resource=resource)
    provider.add_span_processor(
        BatchSpanProcessor(OTLPSpanExporter(endpoint=f"{endpoint}/v1/traces"))
    )
    trace.set_tracer_provider(provider)

    reader = PeriodicExportingMetricReader(
        OTLPMetricExporter(endpoint=f"{endpoint}/v1/metrics")
    )
    metrics.set_meter_provider(
        MeterProvider(resource=resource, metric_readers=[reader])
    )

    FastAPIInstrumentor.instrument_app(app)
    logging.getLogger("otel").info(
        "OTel started", extra={"event": "otel.started", "operation": endpoint}
    )
