"""Regenerate the Python-owned ``/v1/place`` contract fixtures
(``packages/shared/contract/place/``): LinUCB, pairwise, cold bandit,
displacement and the two infeasible fallbacks (ADR-0003 section 5).

    uv run python -m scripts.gen_place_fixtures

The expected responses come from the service itself, so review the diff of these
files like any golden update (a change means ranking behaviour changed).
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

os.environ.setdefault("OTEL_SDK_DISABLED", "true")

from fastapi.testclient import TestClient  # noqa: E402

from src.api import app  # noqa: E402
from src.core.constants import FEATURE_DIM  # noqa: E402

OUT = Path(__file__).resolve().parents[3] / "packages/shared/contract/place"
NOW = 1_789_977_600_000  # Mon 2026-09-21 08:00 UTC
H = 3_600_000
DAY = 24 * H
TYPES = ("LECTURE", "ASSIGNMENT", "EXAM", "TASK", "DND")
ZERO = {t: {"hours": 0, "count": 0} for t in TYPES}
ARMS = ("EARLY_MORNING", "MORNING", "MIDDAY", "AFTERNOON", "EVENING", "NIGHT")
REQ_ID = "00000000-0000-4000-8000-000000000002"


def matrix() -> list[float]:
    m = [0.0] * 168
    for wd in range(7):
        for h in (8, 9, 10):
            m[wd * 24 + h] = 1.0
        for h in (14, 15, 16):
            m[wd * 24 + h] = 0.5
    return m


def day(i: int, occupied: list[tuple[int, int]] | None = None) -> dict[str, Any]:
    start = NOW - 8 * H + i * DAY
    return {
        "dayStr": f"2026-09-{21 + i:02d}",
        "dayStartMs": start,
        "dayEndMs": start + DAY,
        "occupied": [{"startMs": a, "endMs": b} for a, b in occupied or []],
        "workloadByType": ZERO,
    }


def member(policy: str, both: bool = False) -> dict[str, Any]:
    return {
        "id": "t1",
        "durationMinutes": 60,
        "primaryPolicy": policy,
        "computeBoth": both,
    }


def base(**kw: Any) -> dict[str, Any]:
    req: dict[str, Any] = {
        "contractVersion": 1,
        "requestId": REQ_ID,
        "mode": "PLACE",
        "nowMs": NOW,
        "timezone": "UTC",
        "maxScanDays": 30,
        "fixedOccupied": [],
        "deadlineMs": NOW + 3 * DAY,
        "members": [member("LINUCB")],
        "days": [day(i) for i in range(4)],
        "user": {"preferenceMatrix": matrix(), "observationCount": 0},
    }
    req.update(kw)
    return req


def warm_state() -> dict[str, Any]:
    """Deterministic non-trivial (A, b): diagonal design, per-arm bias response."""
    out: dict[str, Any] = {}
    for k, arm in enumerate(ARMS):
        a = [0.0] * (FEATURE_DIM * FEATURE_DIM)
        for i in range(FEATURE_DIM):
            a[i * FEATURE_DIM + i] = 2.0 + 0.1 * i
        b = [0.0] * FEATURE_DIM
        b[-1] = [0.0, 0.2, 0.7, 0.9, 0.6, -0.3][k]
        out[arm] = {"A": a, "b": b}
    return out


def cold_state() -> dict[str, Any]:
    return {arm: {"A": [], "b": []} for arm in ARMS}


FLEX = [
    {"id": "f1", "durationMinutes": 120, "deadlineMs": NOW + DAY, "startMs": NOW},
    {
        "id": "f2",
        "durationMinutes": 120,
        "deadlineMs": NOW + DAY,
        "startMs": NOW + 2 * H,
    },
]


def blocked(policy: str | None) -> dict[str, Any]:
    iv = [{"startMs": NOW - H, "endMs": NOW + DAY}]
    ctx: dict[str, Any] = {"flexible": [], "fixed": iv, "horizonOccupied": iv}
    return base(
        requestId=REQ_ID + "-2",
        deadlineMs=NOW + 2 * H,
        days=[day(0, [(NOW - H, NOW + DAY)])],
        members=[member("HEURISTIC")],
        infeasible={"policy": policy, **ctx} if policy else ctx,
    )


CASES: list[tuple[str, str, dict[str, Any]]] = [
    (
        "single-linucb-cold-bandit",
        "One 60 min task, LINUCB primary, all five arms cold (ridge prior: every "
        "arm scores the same exploration bonus). The seeded tie-break order picks "
        "the band and the task is centred in it; the preference matrix is ignored.",
        base(bandit={"alpha": 0.15, "ridge": 1.0, "state": cold_state()}),
    ),
    (
        "single-linucb-warm-pairwise",
        "computeBoth on a warm user: the response carries both picks (heuristic "
        "from the matrix, LinUCB from the arms alone); primary is LINUCB so "
        "startMs follows it.",
        base(
            members=[member("LINUCB", both=True)],
            user={"preferenceMatrix": matrix(), "observationCount": 100},
            bandit={"alpha": 0.15, "ridge": 1.0, "state": warm_state()},
        ),
    ),
    (
        "single-displaced",
        "08:00-12:00 is two movable 2 h tasks (deadline next day); the new 60 min "
        "task has deadline 12:00. Call 2 repacks with an EDF cascade.",
        base(
            requestId=REQ_ID + "-2",
            deadlineMs=NOW + 4 * H,
            days=[day(0, [(NOW, NOW + 2 * H), (NOW + 2 * H, NOW + 4 * H)])],
            members=[member("HEURISTIC")],
            infeasible={"flexible": FLEX, "fixed": [], "horizonOccupied": []},
        ),
    ),
    (
        "single-accepted-conflicts",
        "Everything up to the deadline is fixed-occupied and nothing is movable; "
        "policy ACCEPT_CONFLICTS picks the min-overlap start (conflicting=true).",
        blocked("ACCEPT_CONFLICTS"),
    ),
    (
        "single-accepted-late",
        "Same blocked schedule; ACCEPT_LATE_DEADLINE places the first "
        "conflict-free start whose end passes the deadline (late=true).",
        blocked("ACCEPT_LATE_DEADLINE"),
    ),
    (
        "single-last-resort",
        "Same blocked schedule, no policy, PLACE (the row already exists): the "
        "task is never left unplaced -- least-conflict start before the deadline "
        "(ACCEPTED_LAST_RESORT, conflicting=true). PREFLIGHT would answer "
        "INFEASIBLE (see single-infeasible-second-call).",
        blocked(None),
    ),
    (
        "series-last-resort-past-deadline",
        "Two 60 min sittings whose deadline has already passed: nothing is "
        "scanned; PLACE pins them back-to-back from the next slot "
        "(ACCEPTED_LAST_RESORT, late=true).",
        base(
            deadlineMs=NOW - H,
            maxScanDays=60,
            members=[
                {**member("HEURISTIC"), "id": "a"},
                {**member("HEURISTIC"), "id": "b"},
            ],
        ),
    ),
    (
        "series-pairwise-heuristic-primary",
        "Pairwise-sampled series (#58): three 60 min sittings, every member "
        "HEURISTIC primary with computeBoth. Python builds two complete plans "
        "over one batch, each with its own sibling ledger: `heuristic` is the "
        "sitting's pick in the all-heuristic plan (applied, so startMs follows "
        "it), `linucb` its pick in the independent all-LinUCB plan.",
        base(
            requestId=REQ_ID + "-3",
            members=[
                {**member("HEURISTIC", both=True), "id": f"s{i}"} for i in range(3)
            ],
            user={"preferenceMatrix": matrix(), "observationCount": 100},
            bandit={"alpha": 0.15, "ridge": 1.0, "state": warm_state()},
        ),
    ),
    (
        "series-pairwise-linucb-primary",
        "Same sampled series with LINUCB primary: startMs / appliedPolicy follow "
        "the all-LinUCB plan; `heuristic` is still each sitting's pick in the "
        "independent all-heuristic plan.",
        base(
            requestId=REQ_ID + "-3",
            members=[{**member("LINUCB", both=True), "id": f"s{i}"} for i in range(3)],
            user={"preferenceMatrix": matrix(), "observationCount": 100},
            bandit={"alpha": 0.15, "ridge": 1.0, "state": warm_state()},
        ),
    ),
]


def main() -> None:
    client = TestClient(app)
    for name, description, request in CASES:
        r = client.post("/v1/place", json=request)
        r.raise_for_status()
        fixture = {
            "name": name,
            "description": description,
            "ignore": ["paramsVersion", "timingsMs"],
            "request": request,
            "response": r.json(),
        }
        (OUT / f"{name}.json").write_text(
            json.dumps(fixture, indent=2) + "\n", encoding="utf-8"
        )
        print("wrote", name, [m["outcome"] for m in r.json()["results"]])


if __name__ == "__main__":
    main()
