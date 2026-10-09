"""Simulator core: archetypes, utility, learning-rule and /v1/place parity."""

from __future__ import annotations

from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient

from src.api import app
from src.core import constants as consts
from src.core.arms import ARM_BANDS
from src.core.context_vector import build_context_vector
from src.core.preference import (
    default_preference_matrix,
    reinforce_preference_cell,
    reinforce_preference_move,
)
from src.core.reward import drag_distance_reward
from src.core.slot import add_days_str
from src.models.linucb import update as linucb_update
from src.schemas_place import PLACEMENT_CONTRACT_VERSION
from src.simulation.archetypes import (
    BEHAVIORS,
    CHRONOTYPES,
    all_cells,
    make_student,
)
from src.simulation.engine import HEURISTIC, SimConfig, World, run_student
from src.simulation.learner import ARMS, LinUCBState, PreferenceMatrix
from src.simulation.reaction import decide, draw_reaction
from src.simulation.rng import stream
from src.simulation.utility import DayContext, slot_utility
from src.simulation.world import (
    EPOCH_MS,
    SCENARIO_BY_NAME,
    TZ,
    build_calendar,
    build_drift,
    build_tasks,
    day_index,
    n_calendar_days,
)

client = TestClient(app)


# ---- archetypes ---------------------------------------------------------


def test_balanced_students_cover_every_chronotype_behavior_cell() -> None:
    cells = {make_student(7, i).cell for i in range(len(all_cells()))}
    assert len(cells) == len(CHRONOTYPES) * len(BEHAVIORS)


def test_independent_draws_reach_every_cell_and_axes_are_independent() -> None:
    drawn = [make_student(3, i, balanced=False) for i in range(600)]
    counts: dict[str, int] = {}
    for s in drawn:
        counts[s.cell] = counts.get(s.cell, 0) + 1
    assert len(counts) == len(all_cells())
    # each cell holds ~1/15 of the students: neither axis pins the other
    assert min(counts.values()) > 600 / 15 * 0.4


def test_same_cell_students_differ_and_chronotypes_overlap() -> None:
    by_chrono: dict[str, list[float]] = {}
    by_cell: dict[str, list[float]] = {}
    for i in range(300):
        s = make_student(5, i)
        by_cell.setdefault(s.cell, []).append(s.peak_hour)
        by_chrono.setdefault(s.chronotype, []).append(s.peak_hour)
    for peaks in by_cell.values():
        assert len(set(peaks)) == len(peaks)
        assert max(peaks) - min(peaks) > 2.0  # humans are spread, not jittered
    # the chronotypes are not separate clusters: late early birds and early midday
    # students share hours
    assert max(by_chrono["early_bird"]) > min(by_chrono["midday"])


def test_behaviour_traits_are_mixed_across_labels() -> None:
    students = [make_student(5, i) for i in range(600)]
    stable = [s for s in students if s.behavior == "stable"]
    assert any(s.cram_weight > 0 for s in stable)  # not only crammers cram
    assert any(s.plan_weight > 0 for s in stable)
    assert any(s.weekend_weight > 0 for s in stable)
    assert any(s.cram_weight == 0 for s in students if s.behavior == "crammer") is False
    shapes = {
        (round(s.sleep_penalty, 2), round(s.load_sensitivity, 2)) for s in students
    }
    assert len(shapes) > 500  # utility shape constants differ per student


def test_profiles_are_a_pure_function_of_seed_and_id() -> None:
    assert make_student(1, 4) == make_student(1, 4)
    assert make_student(1, 4) != make_student(2, 4)


# ---- hidden utility ------------------------------------------------------


def _sample_utilities(sid: int) -> tuple[np.ndarray, ...]:
    p = make_student(1, sid)
    rng = np.random.default_rng(0)
    rows: list[tuple[int, float, float, float, int, float]] = []
    while len(rows) < 2500:
        wd = int(rng.integers(1, 8))
        left = float(rng.integers(0, 10))
        fixed = float(rng.integers(0, 7))
        dur = int(rng.choice([30, 60, 90, 120]))
        minute = float(rng.integers(0, 96) * 15)
        if minute + dur > 1440:
            continue
        u = slot_utility(p, DayContext(wd, left, fixed, 0.0), np.array([minute]), dur)
        rows.append((wd, minute, left, fixed, dur, float(u[0])))
    r = np.array(rows)
    return r[:, 0], r[:, 1], r[:, 2], r[:, 3], r[:, 4], r[:, 5]


def _unexplained(sid: int) -> tuple[float, float]:
    """Share of utility variance the best weekday x hour table / the best
    per-arm linear model of the d = 7 context cannot explain."""
    wd, minute, left, fixed, dur, u = _sample_utilities(sid)
    total = float(((u - u.mean()) ** 2).sum())
    cell = ((wd.astype(int) - 1) * 24 + (minute // 60).astype(int)).astype(int)
    table = np.zeros(168)
    for c in np.unique(cell):
        table[c] = u[cell == c].mean()
    table_res = float(((u - table[cell]) ** 2).sum()) / total

    x = np.array(
        [
            build_context_vector(
                remaining_days_until_deadline=lf,
                duration_minutes=du,
                candidate_iso_weekday=int(w),
                candidate_days_from_now=lf,
                workload_by_type={"LECTURE": {"hours": fx}},
            )
            for w, lf, fx, du in zip(wd, left, fixed, dur, strict=True)
        ]
    )
    arm = np.array(
        [next(i for i, (_, a, b) in enumerate(ARM_BANDS) if a <= m < b) for m in minute]
    )
    pred = np.zeros_like(u)
    for a in range(len(ARM_BANDS)):
        k = arm == a
        if k.sum() > 7:
            w, *_ = np.linalg.lstsq(x[k], u[k], rcond=None)
            pred[k] = x[k] @ w
    return table_res, float(((u - pred) ** 2).sum()) / total


@pytest.mark.parametrize("sid", range(len(all_cells())))
def test_hidden_utility_is_neither_models_class(sid: int) -> None:
    table_res, linear_res = _unexplained(sid)
    assert table_res > 0.005, f"{make_student(1, sid).cell}: table fits exactly"
    assert linear_res > 0.02, f"{make_student(1, sid).cell}: LinUCB fits exactly"


def test_context_dependent_behaviors_defeat_the_table_most() -> None:
    crammer = next(i for i in range(15) if make_student(1, i).behavior == "crammer")
    stable = next(i for i in range(15) if make_student(1, i).behavior == "stable")
    assert _unexplained(crammer)[0] > 5 * _unexplained(stable)[0]


def test_chronotype_peaks_where_it_should() -> None:
    minutes = np.arange(0, 1440 - 60, 15, dtype=np.float64)
    for chrono, lo, hi in (("early_bird", 5, 12), ("night_owl", 19, 24)):
        s = next(
            make_student(1, i)
            for i in range(60)
            if make_student(1, i).chronotype == chrono
            and make_student(1, i).behavior == "stable"
        )
        u = slot_utility(s, DayContext(2, 5.0, 0.0, 0.0), minutes, 60)
        assert lo <= minutes[int(np.argmax(u))] / 60 < hi


# ---- world ----------------------------------------------------------------


def test_world_is_a_pure_function_of_the_seed() -> None:
    a = build_tasks(1, 2, SCENARIO_BY_NAME["series3-tight"], 10)
    assert a == build_tasks(1, 2, SCENARIO_BY_NAME["series3-tight"], 10)
    assert a != build_tasks(2, 2, SCENARIO_BY_NAME["series3-tight"], 10)
    assert build_calendar(1, 2, 30).fixed == build_calendar(1, 2, 30).fixed
    p = make_student(1, 1)
    np.testing.assert_array_equal(build_drift(1, p, 30), build_drift(1, p, 30))


def test_series_span_gives_every_member_a_day() -> None:
    for name in ("series3-tight", "series6-tight"):
        sc = SCENARIO_BY_NAME[name]
        for t in build_tasks(1, 0, sc, 20):
            span_days = (t.deadline_ms - t.now_ms) // consts.DAY_MS
            assert span_days >= t.n_members - 1


def test_streams_are_independent_and_reproducible() -> None:
    assert stream(1, "tasks", 0).random() == stream(1, "tasks", 0).random()
    assert stream(1, "tasks", 0).random() != stream(1, "tasks", 1).random()
    assert stream(1, "tasks", 0).random() != stream(1, "drift", 0).random()


# ---- reaction ---------------------------------------------------------------


def test_reaction_draws_are_shared_across_worlds_and_threshold_gates_moves() -> None:
    p = make_student(1, 0)
    d1 = draw_reaction(1, 0, 5, 0)
    d2 = draw_reaction(1, 0, 5, 0)
    assert d1.eps_prop == d2.eps_prop and d1.u_act == d2.u_act
    starts = EPOCH_MS + np.arange(10, dtype=np.int64) * consts.SLOT_MS
    flat = np.zeros(10)
    assert decide(p, d1, int(starts[3]), 0.0, starts, flat) is None  # nothing to gain
    big = np.zeros(10)
    big[7] = 50.0
    eager = d1.__class__(0.0, 0.0, np.zeros_like(d1.eps_slots))
    assert decide(p, eager, int(starts[3]), 0.0, starts, big) == int(starts[7])
    lazy = d1.__class__(0.0, 0.999999, np.zeros_like(d1.eps_slots))
    assert (
        decide(p, lazy, int(starts[3]), 0.0, starts, big) is None
    )  # cannot be bothered


# ---- learning-rule parity ---------------------------------------------------


def test_preference_rules_are_the_core_functions() -> None:
    m = PreferenceMatrix(TZ)
    start, new = EPOCH_MS + 9 * 3_600_000, EPOCH_MS + 15 * 3_600_000
    m.moved(start, new, 360.0)
    want = reinforce_preference_move(default_preference_matrix(), start, new, TZ, 360)
    np.testing.assert_allclose(m.matrix, want)
    base = default_preference_matrix()
    m2 = PreferenceMatrix(TZ)
    m2.retained(new)  # 15:00 starts at 0.5, below the clamp
    np.testing.assert_allclose(
        m2.matrix,
        reinforce_preference_cell(base, new, TZ, consts.PREFERENCE_RETAINED_WEIGHT),
    )
    # production constants: eta = 0.2, retained weight 0.25
    i = int(np.argmax(m2.matrix - base))
    assert m2.matrix[i] - base[i] == pytest.approx(0.2 * 0.25)


def test_linucb_state_matches_models_update_and_rewards() -> None:
    st = LinUCBState(0.15, 1.0)
    x = np.linspace(-1, 1, consts.FEATURE_DIM)
    st.observe("MORNING", x, 1.0)
    st.observe("MORNING", x, drag_distance_reward(120))  # -0.5
    a, b = linucb_update(
        np.eye(consts.FEATURE_DIM), np.zeros(consts.FEATURE_DIM), x, 1.0
    )
    a, b = linucb_update(a, b, x, -0.5)
    np.testing.assert_allclose(st.a["MORNING"], a)
    np.testing.assert_allclose(st.b["MORNING"], b)
    np.testing.assert_allclose(st.a["NIGHT"], np.eye(consts.FEATURE_DIM))  # untouched


def test_world_updates_equal_the_logged_observations() -> None:
    cfg = SimConfig(seed=2, n_events=14, scenarios=("single",), alphas=(0.15,))
    p = make_student(2, 3)
    cal = build_calendar(2, 3, n_calendar_days(14))
    tasks = build_tasks(2, 3, SCENARIO_BY_NAME["single"], 14)
    w = World(
        cfg,
        p,
        tasks,
        cal,
        build_drift(2, p, n_calendar_days(14)),
        "linucb",
        0.15,
        "single",
    )
    log = w.run()
    assert w.linucb is not None
    # every LinUCB-proposed placement adds exactly one rank-1 update
    n_obs = int(sum(log.used_linucb))
    trace = sum(float(np.trace(w.linucb.a[a])) - consts.FEATURE_DIM for a in ARMS)
    assert trace > 0 and n_obs > 0
    # x . x = (d - 1 bounded features) + bias: at most 7, at least the bias (1)
    assert n_obs <= trace <= n_obs * consts.FEATURE_DIM


# ---- paired runs --------------------------------------------------------------


def test_run_student_is_deterministic_and_paired() -> None:
    cfg = SimConfig(seed=4, n_events=12, scenarios=("single", "series3-tight"))
    a, b = run_student(cfg, 2), run_student(cfg, 2)
    for sc in cfg.scenarios:
        for pol in a.logs[sc]:
            for col, arr in a.logs[sc][pol].items():
                np.testing.assert_array_equal(arr, b.logs[sc][pol][col])
        h, ln = a.logs[sc][HEURISTIC], a.logs[sc]["linucb@0.15"]
        assert set(h["task_id"]) == set(ln["task_id"])  # same task stream
        assert (h["regret"] >= 0).all() and (ln["regret"] >= 0).all()
        assert h["used_linucb"].sum() == 0 and ln["used_linucb"].mean() > 0.9
    assert (
        run_student(SimConfig(seed=5, n_events=12, scenarios=("single",)), 2)
        is not None
    )


# ---- /v1/place parity -----------------------------------------------------------


def _warm_world(policy: str, sid: int, seed: int = 9) -> World:
    cfg = SimConfig(seed=seed, n_events=20, scenarios=("single",))
    p = make_student(seed, sid)
    n = n_calendar_days(20)
    w = World(
        cfg,
        p,
        build_tasks(seed, sid, SCENARIO_BY_NAME["single"], 20),
        build_calendar(seed, sid, n),
        build_drift(seed, p, n),
        policy,
        0.15,
        "single",
    )
    rng = np.random.default_rng(sid)
    if w.linucb is not None:
        for arm in ARMS:
            for _ in range(6):
                w.linucb.observe(
                    arm,
                    rng.uniform(-1, 1, consts.FEATURE_DIM),
                    float(rng.uniform(-1, 1)),
                )
    w.prefs.matrix = rng.uniform(-1, 1, 168)
    return w


def _request(w: World, task: Any, policy: str) -> dict[str, Any]:
    first, last = day_index(task.now_ms), day_index(task.deadline_ms - 1)
    zero = {
        t: {"hours": 0, "count": 0}
        for t in ("LECTURE", "ASSIGNMENT", "EXAM", "TASK", "DND")
    }
    days = []
    for d in range(first, last + 1):
        wl: dict[str, dict[str, float]] = {k: dict(v) for k, v in zero.items()}
        wl["LECTURE"]["hours"] = w.cal.fixed_hours[d]
        days.append(
            {
                "dayStr": add_days_str("2026-01-05", d),
                "dayStartMs": EPOCH_MS + d * consts.DAY_MS,
                "dayEndMs": EPOCH_MS + (d + 1) * consts.DAY_MS,
                "occupied": [{"startMs": s, "endMs": e} for s, e in w.cal.fixed[d]],
                "workloadByType": wl,
            }
        )
    assert w.linucb is not None
    state = {
        arm: {"A": w.linucb.a[arm].reshape(-1).tolist(), "b": w.linucb.b[arm].tolist()}
        for arm in ARMS
    }
    return {
        "contractVersion": PLACEMENT_CONTRACT_VERSION,
        "requestId": "parity",
        "mode": "PLACE",
        "nowMs": task.now_ms,
        "timezone": TZ,
        "deadlineMs": task.deadline_ms,
        "maxScanDays": 30,
        "members": [
            {
                "id": "t1",
                "durationMinutes": task.duration,
                "primaryPolicy": policy,
                "computeBoth": True,
            }
        ],
        "fixedOccupied": [],
        "days": days,
        "user": {"preferenceMatrix": w.prefs.matrix.tolist(), "observationCount": 0},
        "bandit": {"alpha": 0.15, "ridge": 1.0, "state": state},
    }


@pytest.mark.parametrize("sid", [0, 3, 5, 8])
def test_single_placements_match_v1_place_for_both_policies(sid: int) -> None:
    lw = _warm_world("linucb", sid)
    hw = _warm_world(HEURISTIC, sid)
    hw.prefs.matrix = lw.prefs.matrix.copy()
    for task in lw.tasks[:6]:
        res = client.post("/v1/place", json=_request(lw, task, "LINUCB"))
        assert res.status_code == 200, res.text
        out = res.json()["results"][0]
        flex = lw._flex_hours()
        lw._tie_seed = lambda t, m: "parity|t1"  # type: ignore[method-assign,assignment]
        lin = lw._propose_all(task, flex)[0]
        heu = hw._propose_all(task, flex)[0]
        assert lin is not None and heu is not None
        assert heu.start_ms == out["heuristic"]["startMs"]
        assert lin.start_ms == out["linucb"]["startMs"]
        assert lin.arm == out["linucb"]["selectedArm"]
        assert lin.x is not None
        np.testing.assert_allclose(lin.x, out["linucb"]["featureVector"])


def test_series_members_use_the_series_windows_and_one_sitting_per_day() -> None:
    cfg = SimConfig(seed=3, n_events=10, scenarios=("series6-tight",))
    p = make_student(3, 1)
    n = n_calendar_days(10)
    tasks = build_tasks(3, 1, SCENARIO_BY_NAME["series6-tight"], 10)
    w = World(
        cfg,
        p,
        tasks,
        build_calendar(3, 1, n),
        build_drift(3, p, n),
        HEURISTIC,
        0.0,
        "series6-tight",
    )
    for t in tasks:
        props = [x for x in w._propose_all(t, {}) if x is not None]
        days = [day_index(x.start_ms) for x in props]
        assert len(days) == len(set(days))  # MAX_SERIES_PER_DAY
        ivs = sorted((x.start_ms, x.start_ms + t.duration * 60_000) for x in props)
        assert all(a[1] <= b[0] for a, b in zip(ivs, ivs[1:], strict=False))
