"""Parity against the fixtures exported by the TS core
(``backend/scripts/export-golden-fixtures.ts``, output ``backend/test/golden``).

Post-ADR-0003-phase-6, the TS core is the *frozen fallback* only (LinUCB /
displacement / arm-scoring math moved to ``services/bandit/src/core`` and is
no longer golden-tested here — Python's own tests are authoritative for it).
This file only covers what's still exported by the golden JSON: the frozen
heuristic best-free-slot scoring and sync-conflict detection.

Each top-level key is a core function; every case is ``{input, output[, name]}``.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from src.core import slot_score, sync_conflicts

GOLDEN = (
    Path(__file__).resolve().parents[3]
    / "backend/test/golden/scheduler-core.golden.json"
)
DOC = json.loads(GOLDEN.read_text(encoding="utf-8"))


def _occ(items: list[dict[str, int]]) -> list[tuple[int, int]]:
    return [(o["start"], o["end"]) for o in items]


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


RUNNERS: dict[str, Any] = {
    "slotPreferenceScore": lambda i: slot_score.slot_preference_score(
        i["prefMatrix"], i["startMs"], i["endMs"], i["timezone"]
    ),
    "stabilityScore": lambda i: slot_score.stability_score(
        i["prevStartMs"], i["newStartMs"]
    ),
    "bestFreeSlot": _bfs,
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
