"""Keep the OTel SDK off during tests — `src.api` calls `setup_otel(app)` at
import, and we don't want span/metric exporters trying to reach a collector.
Loaded before any test module (so before `from src.api import app`)."""

import os

os.environ.setdefault("OTEL_SDK_DISABLED", "true")
