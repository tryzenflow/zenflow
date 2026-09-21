"""Parity of ``src/core`` (numpy) against golden fixtures for the TS scheduler core.

Fixtures live in ``tests/fixtures/golden/*.json`` (shared with the backend
exporter). Format: ``{"function", "cases": [{"name", "fn", "args", "expected"}]}``.
Times are epoch ms; matrices may be the string ``"DEFAULT"`` (defaultPreferenceMatrix)
or ``{"const": "zeros"}``. Preference cases use ``expected_cell`` ``[idx, value]``
or ``expected_cells`` ``{idx: value}`` (all other cells must equal the input).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from src.core import arms, context_vector, preference, reward, series_spread, slot
from src.core.slot_score import best_free_slot

GOLDEN = Path(__file__).parent / "fixtures" / "golden"


def _matrix(v: Any) -> Any:
    if v == "DEFAULT":
        return preference.default_preference_matrix()
    if isinstance(v, dict) and v.get("const") == "zeros":
        return np.zeros(168)
    return v


def _occ(items: list[dict[str, int]]) -> list[tuple[int, int]]:
    return [(o["start"], o["end"]) for o in items]


def _ctx(a: dict[str, Any]) -> Any:
    return context_vector.build_context_vector(
        remaining_days_until_deadline=a["remainingDaysUntilDeadline"],
        duration_minutes=a["durationMinutes"],
        candidate_iso_weekday=a["candidateIsoWeekday"],
        candidate_days_from_now=a["candidateDaysFromNow"],
        workload_by_type=a.get("workloadByType"),
        semester_phase=a.get("semesterPhase"),
    )


def _bfs(*a: Any) -> Any:
    fit = a[6] if len(a) > 6 else None
    prev = a[7] if len(a) > 7 else None
    return best_free_slot(a[0], _occ(a[1]), a[2], a[3], _matrix(a[4]), a[5], fit, prev)


DISPATCH: dict[str, Any] = {
    "ceilToSlot": slot.ceil_to_slot,
    "floorToSlot": slot.floor_to_slot,
    "isoWeekday": slot.iso_weekday,
    "dayDiffStr": slot.day_diff_str,
    "addDaysStr": slot.add_days_str,
    "localDateStr": slot.local_date_str,
    "deadlineDayStr": slot.deadline_day_str,
    "utcToMinutes": slot.utc_to_minutes,
    "armOfMinute": arms.arm_of_minute,
    "overlapRate": arms.overlap_rate,
    "dragDistanceReward": reward.drag_distance_reward,
    "seriesDayWindows": lambda s, c: [
        list(w) for w in series_spread.series_day_windows(s, c)
    ],
    "decayMatrix": lambda m, d, *h: preference.decay_matrix(m, d, *h),
    "buildContextVector": _ctx,
    "reinforcePreferenceCell": lambda m, at, tz, d, *r: (
        preference.reinforce_preference_cell(_matrix(m), at, tz, d, *r)
    ),
    "reinforcePreferenceMove": lambda m, o, n, tz, drag, *r: (
        preference.reinforce_preference_move(_matrix(m), o, n, tz, drag, *r)
    ),
    "bestFreeSlot": _bfs,
}


def _cases() -> list[Any]:
    out = []
    for path in sorted(GOLDEN.glob("*.json")):
        doc = json.loads(path.read_text())
        for c in doc["cases"]:
            out.append(pytest.param(c, id=f"{path.stem}:{c['name']}"))
    return out


@pytest.mark.parametrize("case", _cases())
def test_golden(case: dict[str, Any]) -> None:
    fn = DISPATCH[case["fn"]]
    got = fn(*case["args"])
    if "expected_cell" in case or "expected_cells" in case:
        base = _matrix(case["args"][0])
        base = preference.effective_preference_matrix(base)
        expected = base.copy()
        if "expected_cell" in case:
            i, v = case["expected_cell"]
            expected[i] = v
        else:
            for i, v in case["expected_cells"].items():
                expected[int(i)] = v
        np.testing.assert_allclose(got, expected, atol=1e-9)
        return
    exp = case["expected"]
    if isinstance(exp, list) or isinstance(got, np.ndarray):
        np.testing.assert_allclose(np.asarray(got), np.asarray(exp), atol=1e-9)
    elif isinstance(exp, float):
        assert got == pytest.approx(exp, abs=1e-9)
    else:
        assert got == exp
