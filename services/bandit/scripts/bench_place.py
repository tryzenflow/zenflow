"""Latency benchmark of ``POST /v1/place`` for one placement at a 30-day scan
(ADR-0003 target: server p99 < 400 ms, scan p95 < 50 ms).

    uv run python -m scripts.bench_place

Measures the full ASGI round trip through ``TestClient`` (JSON encode/decode +
validation + handler; no network) and the handler's own ``timingsMs``.
"""

from __future__ import annotations

import json
import os
import statistics
import time
from typing import Any

os.environ.setdefault("OTEL_SDK_DISABLED", "true")

import numpy as np  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from src.api import app  # noqa: E402
from src.core.constants import DAY_MS, FEATURE_DIM, SLOT_MS  # noqa: E402
from src.core.preference import default_preference_matrix  # noqa: E402
from src.core.slot import add_days_str, local_midnight_ms  # noqa: E402

NOW = 1_789_977_600_000  # 2026-09-21T08:00Z
TZ = "Europe/Paris"
RUNS = 200


def build(policy: str, both: bool, blocks_per_day: int) -> dict[str, Any]:
    rng = np.random.default_rng(0)
    days = []
    for i in range(30):
        ds = add_days_str("2026-09-21", i)
        start = local_midnight_ms(ds, TZ)
        occ = []
        for _ in range(blocks_per_day):
            a = start + int(rng.integers(0, 90)) * SLOT_MS
            occ.append({"startMs": a, "endMs": a + int(rng.integers(2, 12)) * SLOT_MS})
        days.append(
            {
                "dayStr": ds,
                "dayStartMs": start,
                "dayEndMs": local_midnight_ms(add_days_str(ds, 1), TZ),
                "occupied": occ,
                "workloadByType": {
                    t: {
                        "hours": float(rng.integers(0, 6)),
                        "count": int(rng.integers(0, 4)),
                    }
                    for t in ("LECTURE", "ASSIGNMENT", "EXAM", "TASK", "DND")
                },
            }
        )
    state = {}
    for arm in ("EARLY_MORNING", "MORNING", "MIDDAY", "AFTERNOON", "EVENING", "NIGHT"):
        x = rng.normal(size=(60, FEATURE_DIM))
        a = np.eye(FEATURE_DIM) + x.T @ x / 10
        state[arm] = {
            "A": a.reshape(-1).tolist(),
            "b": (rng.normal(size=FEATURE_DIM) * 0.5).tolist(),
        }
    return {
        "contractVersion": 1,
        "requestId": "bench",
        "mode": "PLACE",
        "nowMs": NOW,
        "timezone": TZ,
        "deadlineMs": NOW + 30 * DAY_MS,
        "maxScanDays": 30,
        "members": [
            {
                "id": "b",
                "durationMinutes": 90,
                "primaryPolicy": policy,
                "computeBoth": both,
            }
        ],
        "fixedOccupied": [],
        "days": days,
        "user": {
            "preferenceMatrix": default_preference_matrix().tolist(),
            "observationCount": 60,
        },
        "bandit": {"alpha": 0.15, "ridge": 1.0, "state": state},
    }


def pct(xs: list[float], p: float) -> float:
    s = sorted(xs)
    return s[min(len(s) - 1, int(p / 100 * len(s)))]


def run(label: str, body: dict[str, Any]) -> None:
    client = TestClient(app)
    payload = json.dumps(body)
    kb = len(payload) / 1024
    for _ in range(10):  # warm caches
        client.post(
            "/v1/place", content=payload, headers={"content-type": "application/json"}
        )
    wall, scan, total = [], [], []
    for _ in range(RUNS):
        t0 = time.perf_counter()
        r = client.post(
            "/v1/place", content=payload, headers={"content-type": "application/json"}
        )
        wall.append((time.perf_counter() - t0) * 1000)
        t = r.json()["timingsMs"]
        scan.append(t["scan"])
        total.append(t["total"])
    m = statistics.median
    print(
        f"{label:<34} {kb:5.0f} KB  round-trip p50/p95/p99 = "
        f"{m(wall):5.1f}/{pct(wall, 95):5.1f}/{pct(wall, 99):5.1f} ms | "
        f"handler p50/p95 = {m(total):5.1f}/{pct(total, 95):5.1f} ms | "
        f"scan p50/p95 = {m(scan):5.1f}/{pct(scan, 95):5.1f} ms"
    )


def main() -> None:
    print(f"{RUNS} runs each, 30-day scan, tz={TZ}, 90 min task")
    run("HEURISTIC primary", build("HEURISTIC", False, 6))
    run("LINUCB primary (warm)", build("LINUCB", False, 6))
    run("computeBoth (LINUCB primary)", build("LINUCB", True, 6))
    run("computeBoth, dense (14 blocks/day)", build("LINUCB", True, 14))


if __name__ == "__main__":
    main()
