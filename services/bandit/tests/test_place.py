"""``POST /v1/place`` (ADR-0003 phase 2): behaviour, auth, errors, determinism."""

from __future__ import annotations

import copy
from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient

from src.api import app
from src.core import displacement
from src.core.arms import seeded_tie_break_order
from src.core.constants import (
    DAY_MS,
    FEATURE_DIM,
    INFEASIBLE_HORIZON_DAYS,
    MS_PER_MINUTE,
)
from src.core.linucb_best_slot import best_linucb_slot, days_from_dicts
from src.core.preference import default_preference_matrix
from src.core.slot import add_days_str, local_date_str, local_midnight_ms

client = TestClient(app)

HOUR = 60 * MS_PER_MINUTE
NOW = 1_789_977_600_000  # Mon 2026-09-21 08:00 UTC
ZERO_WL = {
    t: {"hours": 0, "count": 0}
    for t in ("LECTURE", "ASSIGNMENT", "EXAM", "TASK", "DND")
}


def make_days(
    n: int,
    tz: str = "UTC",
    occupied: dict[int, list[tuple[int, int]]] | None = None,
    start_day: str = "2026-09-21",
) -> list[dict[str, Any]]:
    occupied = occupied or {}
    out = []
    for i in range(n):
        ds = add_days_str(start_day, i)
        out.append(
            {
                "dayStr": ds,
                "dayStartMs": local_midnight_ms(ds, tz),
                "dayEndMs": local_midnight_ms(add_days_str(ds, 1), tz),
                "occupied": [
                    {"startMs": a, "endMs": b} for a, b in occupied.get(i, [])
                ],
                "workloadByType": copy.deepcopy(ZERO_WL),
            }
        )
    return out


def member(
    mid: str = "t1",
    dur: int = 60,
    policy: str = "HEURISTIC",
    both: bool = False,
    prev: int | None = None,
) -> dict[str, Any]:
    m: dict[str, Any] = {
        "id": mid,
        "durationMinutes": dur,
        "primaryPolicy": policy,
        "computeBoth": both,
    }
    if prev is not None:
        m["prevStartMs"] = prev
    return m


def make_req(**kw: Any) -> dict[str, Any]:
    req: dict[str, Any] = {
        "contractVersion": 1,
        "requestId": "test-1",
        "mode": "PLACE",
        "nowMs": NOW,
        "timezone": "UTC",
        "deadlineMs": NOW + 5 * DAY_MS,
        "maxScanDays": 30,
        "members": [member()],
        "fixedOccupied": [],
        "days": make_days(6),
        "user": {
            "preferenceMatrix": default_preference_matrix().tolist(),
            "observationCount": 0,
        },
    }
    req.update(kw)
    return req


def warm_state(seed: int = 3) -> dict[str, dict[str, list[float]]]:
    rng = np.random.default_rng(seed)
    state: dict[str, dict[str, list[float]]] = {}
    for arm in ("EARLY_MORNING", "MORNING", "AFTERNOON", "EVENING", "NIGHT"):
        x = rng.normal(size=(40, FEATURE_DIM))
        a = np.eye(FEATURE_DIM) + x.T @ x / 10
        b = rng.normal(size=FEATURE_DIM) * 0.5
        state[arm] = {"A": a.reshape(-1).tolist(), "b": b.tolist()}
    return state


def post(body: dict[str, Any], **kw: Any) -> Any:
    return client.post("/v1/place", json=body, **kw)


def ok(body: dict[str, Any]) -> dict[str, Any]:
    r = post(body)
    assert r.status_code == 200, r.text
    out: dict[str, Any] = r.json()
    return out


# ---- heuristic ----------------------------------------------------------


def test_single_heuristic_prefers_the_default_morning_hour() -> None:
    res = ok(make_req())
    r = res["results"][0]
    assert r["outcome"] == "PLACED" and r["appliedPolicy"] == "HEURISTIC"
    assert r["linucb"] is None and r["moves"] == []
    assert r["startMs"] == r["heuristic"]["startMs"]
    # default matrix: 08-11 (+1) is the best window; 08:00 today is already past
    # 'now' boundaries -> earliest full-score start is 08:00 (now == 08:00 UTC).
    assert r["startMs"] == NOW
    assert res["paramsVersion"].startswith("py-")
    assert set(res["timingsMs"]) == {
        "decode",
        "context",
        "predict",
        "scan",
        "displace",
        "total",
    }
    assert res["requestId"] == "test-1"


def test_timezone_wall_clock_is_respected() -> None:
    tz = "Asia/Ho_Chi_Minh"  # UTC+7: 'now' is 15:00 local
    days = make_days(6, tz)
    res = ok(make_req(timezone=tz, days=days))
    start = res["results"][0]["startMs"]
    local_h = ((start + 7 * HOUR) % DAY_MS) // HOUR
    assert local_h in (8, 9, 10, 14, 15, 16)  # preferred local hours
    assert start >= NOW


def test_preflight_runs_heuristic_only() -> None:
    res = ok(
        make_req(
            mode="PREFLIGHT",
            members=[member(policy="LINUCB", both=True)],
            bandit={"alpha": 0.15, "ridge": 1.0, "state": warm_state()},
        )
    )
    r = res["results"][0]
    assert r["appliedPolicy"] == "HEURISTIC" and r["linucb"] is None
    assert r["heuristic"] is not None


# ---- linucb -------------------------------------------------------------


def _bandit(state: dict[str, Any] | None = None) -> dict[str, Any]:
    cold: dict[str, Any] = {a: {"A": [], "b": []} for a in warm_state()}
    return {"alpha": 0.15, "ridge": 1.0, "state": state or cold}


def test_linucb_primary_cold_has_pick_and_no_heuristic() -> None:
    res = ok(make_req(members=[member(policy="LINUCB")], bandit=_bandit()))
    r = res["results"][0]
    assert r["appliedPolicy"] == "LINUCB" and r["heuristic"] is None
    lin = r["linucb"]
    assert len(lin["featureVector"]) == FEATURE_DIM
    assert lin["weights"] == {"wL": 1.0, "wS": 0.0}  # no prevStartMs
    assert r["startMs"] == lin["startMs"]


def test_compute_both_returns_both_picks_and_primary_decides_start() -> None:
    body = make_req(
        members=[member(policy="HEURISTIC", both=True)],
        bandit=_bandit(warm_state()),
        user={
            "preferenceMatrix": default_preference_matrix().tolist(),
            "observationCount": 100,
        },
    )
    r = ok(body)["results"][0]
    assert r["heuristic"] and r["linucb"]
    assert r["startMs"] == r["heuristic"]["startMs"]
    body["members"][0]["primaryPolicy"] = "LINUCB"
    r2 = ok(body)["results"][0]
    assert r2["startMs"] == r2["linucb"]["startMs"] and r2["appliedPolicy"] == "LINUCB"


def test_linucb_without_bandit_state_falls_back_to_heuristic() -> None:
    r = ok(make_req(members=[member(policy="LINUCB")]))["results"][0]
    assert r["appliedPolicy"] == "HEURISTIC" and r["linucb"] is None
    assert r["heuristic"] is not None and r["outcome"] == "PLACED"


def test_in_process_arm_scores_match_predict_endpoint() -> None:
    """The slot picked by /v1/place equals best_linucb_slot over the scores the
    separate /predict endpoint returns for the same context vectors."""
    state = warm_state()
    body = make_req(
        members=[member(policy="LINUCB", dur=90)],
        bandit=_bandit(state),
        user={
            "preferenceMatrix": default_preference_matrix().tolist(),
            "observationCount": 25,
        },
    )
    r = ok(body)["results"][0]
    vec = r["linucb"]["featureVector"]
    # every day gets its own vector; rebuild them via the same builder through the
    # response of the first day is not possible, so use the picked day's vector
    # and check its scores against /predict.
    pred = client.post(
        "/predict",
        json={
            "alpha": 0.15,
            "ridge": 1.0,
            "state": state,
            "contexts": [{"day": "picked", "x": vec}],
        },
    ).json()["scores"]["picked"]
    # Recompute the pick with the core: days lacking the picked day's vector are
    # not needed, restrict to the picked day only.
    start = r["linucb"]["startMs"]
    day_str = local_date_str(start, "UTC")
    day = next(d for d in body["days"] if d["dayStr"] == day_str)
    core = best_linucb_slot(
        days_from_dicts(
            [
                {
                    "dayStr": day_str,
                    "dayStartMs": day["dayStartMs"],
                    "dayEndMs": day["dayEndMs"],
                    "occupied": [],
                    "vector": vec,
                    "armScores": pred,
                }
            ]
        ),
        90,
        "UTC",
        NOW,
        body["deadlineMs"],
        None,
        None,
        seeded_tie_break_order(f"{body['requestId']}|t1"),
    )
    assert core is not None
    assert core.start_ms == start and core.arm == r["linucb"]["selectedArm"]
    assert core.score == pytest.approx(r["linucb"]["score"], abs=1e-9)


# ---- series -------------------------------------------------------------


def test_series_spreads_members_over_distinct_windows_without_overlap() -> None:
    members = [member(f"s{i}", 120) for i in range(4)]
    body = make_req(
        members=members,
        deadlineMs=NOW + 8 * DAY_MS,
        days=make_days(9),
        maxScanDays=60,
    )
    res = ok(body)["results"]
    starts = [r["startMs"] for r in res]
    assert all(s is not None for s in starts)
    days = [local_date_str(s, "UTC") for s in starts]
    assert len(set(days)) == 4  # MAX_SERIES_PER_DAY = 1
    assert starts == sorted(starts)
    for a, b in zip(starts, starts[1:], strict=False):
        assert b - a >= 2 * HOUR


def test_series_respects_fixed_occupied_and_reports_no_slot_without_blocking() -> None:
    # 2 members, deadline one day ahead, the second window's day is fully blocked.
    days = make_days(2, occupied={1: [(NOW + 16 * HOUR, NOW + 2 * DAY_MS)]})
    body = make_req(
        members=[member("a"), member("b")],
        deadlineMs=NOW + 2 * DAY_MS - 8 * HOUR,
        days=days,
        maxScanDays=60,
    )
    a, b = ok(body)["results"]
    assert a["outcome"] == "PLACED"
    assert b["outcome"] == "INFEASIBLE" and b["startMs"] is None


def test_series_past_deadline_all_infeasible() -> None:
    body = make_req(
        members=[member("a"), member("b")], deadlineMs=NOW - HOUR, maxScanDays=60
    )
    assert [r["outcome"] for r in ok(body)["results"]] == ["INFEASIBLE"] * 2


# ---- infeasible / displacement -----------------------------------------


def _packed_day() -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """08:00-12:00 is full of two movable tasks; deadline 12:00 for a new 60m task."""
    f1 = (NOW, NOW + 2 * HOUR)
    f2 = (NOW + 2 * HOUR, NOW + 4 * HOUR)
    days = make_days(1, occupied={0: [f1, f2]})
    flex = [
        {
            "id": "f1",
            "durationMinutes": 120,
            "deadlineMs": NOW + DAY_MS,
            "startMs": f1[0],
        },
        {
            "id": "f2",
            "durationMinutes": 120,
            "deadlineMs": NOW + DAY_MS,
            "startMs": f2[0],
        },
    ]
    body = make_req(days=days, deadlineMs=NOW + 4 * HOUR)
    return body, flex


def test_two_phase_displacement_matches_core_planner() -> None:
    body, flex = _packed_day()
    first = ok(body)["results"][0]
    assert first["outcome"] == "NEEDS_INFEASIBLE_CONTEXT" and first["startMs"] is None

    body["requestId"] = "test-1-2"
    body["infeasible"] = {"flexible": flex, "fixed": [], "horizonOccupied": []}
    r = ok(body)["results"][0]
    assert r["outcome"] == "DISPLACED" and r["moves"]

    day_start = body["days"][0]["dayStartMs"]
    plan = displacement.plan_displacement(
        60,
        body["deadlineMs"],
        displacement.flexible_from_dicts(flex),
        [],
        NOW,
        [(day_start, day_start + DAY_MS), (day_start - DAY_MS, day_start + 2 * DAY_MS)],
        [],
        body["deadlineMs"] + INFEASIBLE_HORIZON_DAYS * DAY_MS,
    )
    assert plan.kind == "placed"
    assert r["startMs"] == plan.start_ms
    assert [(m["id"], m["fromMs"], m["toMs"]) for m in r["moves"]] == [
        (m.id, m.from_ms, m.to_ms) for m in plan.moves
    ]


def test_infeasible_without_policy_and_with_each_policy() -> None:
    blocked = (NOW - HOUR, NOW + DAY_MS)
    body = make_req(
        days=make_days(1, occupied={0: [blocked]}),
        deadlineMs=NOW + 2 * HOUR,
        infeasible={
            "flexible": [],
            "fixed": [{"startMs": blocked[0], "endMs": blocked[1]}],
            "horizonOccupied": [{"startMs": blocked[0], "endMs": blocked[1]}],
        },
    )
    assert ok(body)["results"][0]["outcome"] == "INFEASIBLE"

    body["infeasible"]["policy"] = "ACCEPT_CONFLICTS"
    r = ok(body)["results"][0]
    assert r["outcome"] == "ACCEPTED_CONFLICTS" and r["conflicting"] is True
    assert NOW <= r["startMs"] <= NOW + HOUR

    body["infeasible"]["policy"] = "ACCEPT_LATE_DEADLINE"
    r = ok(body)["results"][0]
    assert r["outcome"] == "ACCEPTED_LATE" and r["late"] is True
    assert r["startMs"] + HOUR > body["deadlineMs"]
    assert r["startMs"] >= blocked[1]  # conflict-free


def test_series_members_are_never_displaced() -> None:
    body, flex = _packed_day()
    body["members"] = [member("a", 60), member("b", 60)]
    body["infeasible"] = {"flexible": flex, "fixed": [], "horizonOccupied": []}
    body["maxScanDays"] = 60
    assert all(r["moves"] == [] for r in ok(body)["results"])


# ---- determinism, errors, auth -----------------------------------------


def test_deterministic() -> None:
    body = make_req(
        members=[member("a", policy="LINUCB", both=True), member("b")],
        bandit=_bandit(warm_state()),
        deadlineMs=NOW + 4 * DAY_MS,
        maxScanDays=60,
    )
    a, b = ok(body), ok(body)
    for x in (a, b):
        x.pop("timingsMs")
    assert a == b


def test_contract_version_mismatch_is_422_with_code() -> None:
    r = post(make_req(contractVersion=2))
    assert r.status_code == 422 and r.json()["code"] == "CONTRACT_VERSION"
    r = post(make_req(contractVersion=2, brandNewField=1))
    assert r.status_code == 422 and r.json()["code"] == "CONTRACT_VERSION"


@pytest.mark.parametrize(
    "mutate",
    [
        lambda b: b.update(unknownField=1),
        lambda b: b["members"][0].update(durationMinutes=50),
        lambda b: b["user"].update(preferenceMatrix=[0.0] * 10),
        lambda b: b.update(timezone="Mars/Olympus"),
        lambda b: b.update(members=[]),
        lambda b: b.update(maxScanDays=0),
        lambda b: b.update(mode="NOPE"),
        lambda b: b["days"].append(copy.deepcopy(b["days"][0])),
        lambda b: b.update(
            bandit={
                "alpha": 0.1,
                "ridge": 1,
                "state": {"MORNING": {"A": [1.0], "b": []}},
            }
        ),
    ],
)
def test_invalid_requests_are_422(mutate: Any) -> None:
    body = make_req()
    mutate(body)
    assert post(body).status_code == 422


def test_oversized_body_is_413() -> None:
    body = make_req()
    body["pad"] = "x" * (2 * 1024 * 1024 + 10)
    assert post(body).status_code == 413


def test_ready_endpoint() -> None:
    r = client.get("/ready")
    assert r.status_code == 200 and r.json() == {"status": "ready"}


def test_request_id_header_echo_and_generation() -> None:
    r = client.get("/health", headers={"x-request-id": "abc-123"})
    assert r.headers["x-request-id"] == "abc-123"
    assert client.get("/health").headers["x-request-id"].startswith("req-")


def test_bearer_auth(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("BANDIT_SERVICE_TOKEN", "s3cret")
    monkeypatch.setenv("BANDIT_SERVICE_TOKEN_PREVIOUS", "old")
    body = make_req()
    assert post(body).status_code == 401
    assert post(body, headers={"authorization": "Bearer nope"}).status_code == 401
    assert post(body, headers={"authorization": "Basic s3cret"}).status_code == 401
    assert post(body, headers={"authorization": "Bearer s3cret"}).status_code == 200
    assert post(body, headers={"authorization": "Bearer old"}).status_code == 200
    # every model route is protected, probes are not
    assert client.post("/predict", json={}).status_code == 401
    assert client.post("/v1/update", json={}).status_code == 401
    assert client.get("/health").status_code == 200
    assert client.get("/ready").status_code == 200


def test_predict_and_update_unchanged_without_token() -> None:
    r = client.post(
        "/predict",
        json={
            "alpha": 0.15,
            "ridge": 1.0,
            "state": {a: {"A": [], "b": []} for a in warm_state()},
            "contexts": [{"day": "d", "x": [0.0] * 4}],
        },
    )
    assert r.status_code == 200
    assert r.json()["scores"]["d"]["MORNING"] == 0.0
