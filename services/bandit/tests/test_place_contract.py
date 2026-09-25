"""Contract fixtures (``packages/shared/contract/place/*.json``) and golden TS
end-to-end checks for ``POST /v1/place``.

* Every fixture: POST ``request`` -> must equal ``response`` (minus ``ignore``).
* Golden ``bestFreeSlot`` cases: run as one-day HEURISTIC placements.

LinUCB has no golden-fixture parity check (ADR-0003 phase 6): the TS
implementation it used to compare against was deleted, and LinUCB is now
Python-only, covered by ``services/bandit/tests`` unit/equivalence tests
instead (e.g. ``test_place_batch.py``).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from src.api import app

ROOT = Path(__file__).resolve().parents[3]
FIXTURE_DIR = ROOT / "packages/shared/contract/place"
GOLDEN = json.loads(
    (ROOT / "backend/test/golden/scheduler-core.golden.json").read_text("utf-8")
)
client = TestClient(app)

FIXTURES = sorted(FIXTURE_DIR.glob("*.json"))


def _close(got: Any, exp: Any, path: str = "") -> None:
    if isinstance(exp, dict):
        assert isinstance(got, dict) and got.keys() == exp.keys(), path
        for k in exp:
            _close(got[k], exp[k], f"{path}.{k}")
    elif isinstance(exp, list):
        assert isinstance(got, list) and len(got) == len(exp), path
        for i, (g, e) in enumerate(zip(got, exp, strict=True)):
            _close(g, e, f"{path}[{i}]")
    elif isinstance(exp, float) or isinstance(got, float):
        assert got == pytest.approx(exp, abs=1e-9), path
    else:
        assert got == exp, path


@pytest.mark.skipif(not FIXTURES, reason="no contract fixtures present")
@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: p.stem)
def test_contract_fixture(path: Path) -> None:
    fx = json.loads(path.read_text("utf-8"))
    r = client.post("/v1/place", json=fx["request"])
    assert r.status_code == 200, r.text
    got, exp = r.json(), dict(fx["response"])
    got = dict(got)
    for k in fx.get("ignore", []):
        got.pop(k, None)
        exp.pop(k, None)
    _close(got, exp)


def _one_day_request(i: dict[str, Any]) -> dict[str, Any]:
    start = i["windowStartMs"]
    end = i["windowEndMs"]
    fit = i.get("fitWindowEndMs", end)
    from src.core.slot import local_date_str

    tz = i["timezone"]
    return {
        "contractVersion": 1,
        "requestId": "golden",
        "mode": "PLACE",
        "nowMs": start,
        "timezone": tz,
        "deadlineMs": fit,
        "maxScanDays": 30,
        "members": [
            {
                "id": "g",
                "durationMinutes": i["durationMinutes"],
                "primaryPolicy": "HEURISTIC",
                "computeBoth": False,
                **({"prevStartMs": i["prevStartMs"]} if "prevStartMs" in i else {}),
            }
        ],
        "fixedOccupied": [],
        "days": [
            {
                "dayStr": local_date_str(start, tz),
                "dayStartMs": start,
                "dayEndMs": end,
                "occupied": [
                    {"startMs": o["start"], "endMs": o["end"]} for o in i["occupied"]
                ],
                "workloadByType": {},
            }
        ],
        "user": {"preferenceMatrix": i["prefMatrix"], "observationCount": 0},
    }


@pytest.mark.parametrize("case", GOLDEN["bestFreeSlot"], ids=lambda c: c["name"])
def test_golden_best_free_slot_via_place(case: dict[str, Any]) -> None:
    res = client.post("/v1/place", json=_one_day_request(case["input"]))
    assert res.status_code == 200, res.text
    r = res.json()["results"][0]
    if case["output"] is None:
        assert r["outcome"] == "NEEDS_INFEASIBLE_CONTEXT"
    else:
        assert r["outcome"] == "PLACED" and r["startMs"] == case["output"]
