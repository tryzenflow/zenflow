"""Parity against the fixtures exported by the TS core
(``backend/scripts/export-golden-fixtures.ts``, output ``backend/test/golden``).

Each top-level key is a core function; every case is ``{input, output[, name]}``.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from src.core import adaptive_weights, arms, displacement, slot_score, sync_conflicts
from src.core.linucb_best_slot import best_linucb_slot, days_from_dicts

GOLDEN = (
    Path(__file__).resolve().parents[3]
    / "backend/test/golden/scheduler-core.golden.json"
)
DOC = json.loads(GOLDEN.read_text(encoding="utf-8"))


def _occ(items: list[dict[str, int]]) -> list[tuple[int, int]]:
    return [(o["start"], o["end"]) for o in items]


def _adaptive(i: dict[str, Any]) -> Any:
    w = adaptive_weights.adaptive_weights(i["observationCount"])
    return {"wL": w.wL, "wP": w.wP}


def _rates(i: dict[str, Any]) -> Any:
    r = arms.arm_overlap_rates_from_minute(i["startMinute"], i["durationMinutes"])
    return [{"arm": b[0], "rate": v} for b, v in zip(arms.ARM_BANDS, r, strict=True)]


def _bfs(i: dict[str, Any]) -> Any:
    return slot_score.best_free_slot(
        i["durationMinutes"],
        _occ(i["occupied"]),
        i["windowStartMs"],
        i["windowEndMs"],
        i["prefMatrix"],
        i["timezone"],
        i.get("fitWindowEndMs"),
        i.get("prevStartMs"),
    )


def _linucb(i: dict[str, Any]) -> Any:
    r = best_linucb_slot(
        days_from_dicts(i["days"]),
        i["durationMinutes"],
        i["timezone"],
        i["prefMatrix"],
        i["nextMs"],
        i["deadlineMs"],
        _occ(i.get("extraOccupied", [])),
        i.get("prevStartMs"),
        i.get("observationCount", 0),
    )
    if r is None:
        return None
    return {
        "startMs": r.start_ms,
        "score": r.score,
        "arm": r.arm,
        "vector": r.vector,
        "weights": {"wL": r.weights.wL, "wP": r.weights.wP},
    }


def _plan(i: dict[str, Any]) -> Any:
    p = displacement.plan_displacement(
        i["task"]["durationMinutes"],
        i["task"]["deadlineMs"],
        displacement.flexible_from_dicts(i["flexible"]),
        _occ(i["fixed"]),
        i["nowMs"],
        [(w["startMs"], w["endMs"]) for w in i["windows"]],
        i["prefMatrix"],
        i["timezone"],
        i.get("maxMoves"),
        i.get("candidates"),
    )
    if p.kind == "infeasible":
        return {"kind": "infeasible"}
    return {
        "kind": "placed",
        "startMs": p.start_ms,
        "moves": [{"id": m.id, "fromMs": m.from_ms, "toMs": m.to_ms} for m in p.moves],
    }


def _fallback(fn: Any, late: bool) -> Any:
    def run(i: dict[str, Any]) -> Any:
        args = (i["durationMinutes"], i["nowMs"], i["deadlineMs"], _occ(i["occupied"]))
        if late:
            return fn(*args, i.get("horizonEndMs"))
        return fn(*args, i["prefMatrix"], i["timezone"])

    return run


RUNNERS: dict[str, Any] = {
    "adaptiveWeights": _adaptive,
    "armOfMinute": lambda i: arms.arm_of_minute(i["minuteOfDay"]),
    "armOverlapRatesFromMinute": _rates,
    "overlapRate": lambda i: arms.overlap_rate(
        i["startMs"], i["endMs"], i["arm"], i["timezone"]
    ),
    "slotPreferenceScore": lambda i: slot_score.slot_preference_score(
        i["prefMatrix"], i["startMs"], i["endMs"], i["timezone"]
    ),
    "stabilityScore": lambda i: slot_score.stability_score(
        i["prevStartMs"], i["newStartMs"]
    ),
    "bestFreeSlot": _bfs,
    "bestLinucbSlot": _linucb,
    "planDisplacement": _plan,
    "pickMinConflictSlot": _fallback(displacement.pick_min_conflict_slot, False),
    "pickLateSlot": _fallback(displacement.pick_late_slot, True),
    "findConflictingTaskIds": lambda i: sync_conflicts.find_conflicting_task_ids(
        _occ(i["fixed"]), i["tasks"]
    ),
}


def _close(got: Any, exp: Any) -> None:
    if isinstance(exp, dict):
        assert isinstance(got, dict) and got.keys() == exp.keys()
        for k in exp:
            _close(got[k], exp[k])
    elif isinstance(exp, list):
        assert len(got) == len(exp)
        for g, e in zip(got, exp, strict=True):
            _close(g, e)
    elif isinstance(exp, float) or isinstance(got, float | np.floating):
        assert got == pytest.approx(exp, abs=1e-9)
    else:
        assert got == exp


def _params() -> list[Any]:
    out = []
    for fn, cases in DOC.items():
        if not isinstance(cases, list):
            continue
        for n, c in enumerate(cases):
            out.append(pytest.param(fn, c, id=f"{fn}[{n}]:{c.get('name', '')}"))
    return out


def test_every_exported_function_has_a_runner() -> None:
    exported = {k for k, v in DOC.items() if isinstance(v, list)}
    assert exported <= RUNNERS.keys(), exported - RUNNERS.keys()


@pytest.mark.parametrize(("fn", "case"), _params())
def test_ts_golden(fn: str, case: dict[str, Any]) -> None:
    _close(RUNNERS[fn](case["input"]), case["output"])
