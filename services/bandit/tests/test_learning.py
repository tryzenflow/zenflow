"""Closed-loop learning checks: does LinUCB actually learn a user's band?

Drives the real HTTP surface exactly the way Nest does -- ``POST /v1/place``
with the user's persisted ``(A, b)``, then a delayed reward through
``POST /v1/update`` for the ``selectedArm`` + ``featureVector`` the placement
returned -- against a simulated user with a hidden preferred band:

* placed in the preferred band -> kept -> ``RETAINED`` (+1);
* otherwise the user drags it to the centre of the preferred band on the same
  day -> first ``MOVE``, graded by :func:`drag_distance_reward`.

One placement per simulated day, so the weekday (and the weekend feature)
varies. Everything is deterministic (the only "randomness" is the per-request
seeded tie-break order), so these are cheap, exact regression tests for the
learning speed of the production configuration (alpha, ridge, d, arms).
Run with ``-s`` to print the learning curve.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient

from src.api import app
from src.core.arms import ARM_BANDS
from src.core.constants import DAY_MS, MS_PER_MINUTE
from src.core.reward import drag_distance_reward
from src.core.slot import iso_weekday, local_date_str, local_midnight_ms
from src.schemas import ARM_IDS
from tests.test_place import NOW, make_days, make_req, member

client = TestClient(app)

ALPHA = 0.15  # BANDIT_ALPHA in backend/src/scheduler/constants.ts
RIDGE = 1.0  # BANDIT_RIDGE
DUR = 60
_BAND = {name: (start, end) for name, start, end in ARM_BANDS}

Preference = Callable[[int], str]  # ISO weekday of the placed day -> band


def _centre_start_ms(day_start_ms: int, band: str) -> int:
    start, end = _BAND[band]
    return day_start_ms + int((start + end) / 2 - DUR / 2) * MS_PER_MINUTE


def simulate(
    prefers: Preference,
    episodes: int,
    window_days: int = 3,
    fixed_reward: float | None = None,
) -> list[tuple[str, str, float]]:
    """Run ``episodes`` place -> reward -> update rounds for one user.

    Episode ``k`` is requested at ``NOW + k days`` with a deadline
    ``window_days`` later. ``window_days=0`` pins it to one whole day
    (requested at that day's midnight, due at its end), so every weekday gets
    placements. ``fixed_reward`` overrides the simulated user's reward.
    Returns ``(day, selectedArm, reward)`` per episode.
    """
    state: dict[str, dict[str, list[float]]] = {a: {"A": [], "b": []} for a in ARM_IDS}
    log: list[tuple[str, str, float]] = []
    for k in range(episodes):
        now = NOW + k * DAY_MS
        today = local_date_str(now, "UTC")
        if window_days == 0:
            now = local_midnight_ms(today, "UTC")
            deadline = now + DAY_MS
        else:
            deadline = now + window_days * DAY_MS
        body: dict[str, Any] = make_req(
            requestId=f"sim-{k}",
            nowMs=now,
            deadlineMs=deadline,
            members=[member(policy="LINUCB", dur=DUR)],
            days=make_days(window_days + 1, start_day=today),
            bandit={"alpha": ALPHA, "ridge": RIDGE, "state": state},
        )
        res = client.post("/v1/place", json=body)
        assert res.status_code == 200, res.text
        pick = res.json()["results"][0]
        assert pick["appliedPolicy"] == "LINUCB"
        lin = pick["linucb"]
        arm, start = lin["selectedArm"], lin["startMs"]

        day = local_date_str(start, "UTC")
        day_start = next(d["dayStartMs"] for d in body["days"] if d["dayStr"] == day)
        want = prefers(iso_weekday(day))
        if fixed_reward is not None:
            reward = fixed_reward
        elif arm == want:
            reward = 1.0  # RETAINED (SESSION_RETAINED_REWARD)
        else:
            moved_to = _centre_start_ms(day_start, want)
            reward = drag_distance_reward((moved_to - start) / MS_PER_MINUTE)

        upd = client.post(
            "/v1/update",
            json={
                "ridge": RIDGE,
                "arm": arm,
                "x": lin["featureVector"],
                "reward": reward,
                "state": state[arm],
            },
        )
        assert upd.status_code == 200, upd.text
        state[arm] = upd.json()
        log.append((day, arm, reward))
    return log


def _print_curve(title: str, log: list[tuple[str, str, float]]) -> None:
    print(f"\n{title}")
    for i, (day, arm, reward) in enumerate(log):
        print(f"  {i:3d} {day} {arm:<13} {reward:+.2f}")


def _hit(log: list[tuple[str, str, float]]) -> list[bool]:
    return [reward == 1.0 for *_, reward in log]


@pytest.mark.parametrize("band", ["MORNING", "AFTERNOON", "EVENING", "NIGHT"])
def test_learns_a_fixed_preferred_band_fast(band: str) -> None:
    """A user who always wants ``band``: LinUCB must explore, then lock on
    within a handful of events and stay there."""
    log = simulate(lambda _wd: band, episodes=25)
    _print_curve(f"always {band}", log)
    hits = _hit(log)

    first_hit = hits.index(True)
    assert first_hit <= 3, "4 waking bands -> found within 4 placements"
    assert all(hits[first_hit:]), "once found, a kept band must keep winning"
    # EARLY_MORNING (00:00-06:00) is last in every seeded tie order, so it is
    # only explored once all 4 waking bands have been rejected.
    assert "EARLY_MORNING" not in {arm for _, arm, _ in log}


def test_a_mild_move_still_pushes_exploration_elsewhere() -> None:
    """Regression for the cold-arm lock-in: a user who nudges every placement
    by an hour (MOVE, reward -0.25) must see each waking band tried in turn.
    With cold arms pinned at 0.0 the first moved arm kept winning on its own
    exploration bonus (score +0.075 > 0) and no other band ever got data."""
    log = simulate(lambda _wd: "EVENING", episodes=4, fixed_reward=-0.25)
    tried = [arm for _, arm, _ in log]
    assert sorted(tried) == ["AFTERNOON", "EVENING", "MORNING", "NIGHT"]


def test_learns_a_weekday_vs_weekend_split() -> None:
    """EVENING on weekdays, MORNING at weekends: only learnable through the
    context vector (is_weekend), not through a single best band."""

    def prefers(wd: int) -> str:
        return "MORNING" if wd >= 6 else "EVENING"

    # Single-day windows: the day is forced, only the band is LinUCB's call.
    log = simulate(prefers, episodes=42, window_days=0)  # 6 weeks
    _print_curve("weekday EVENING / weekend MORNING", log)
    hits = _hit(log)

    last_two_weeks = hits[-14:]
    assert all(last_two_weeks), f"late misses: {last_two_weeks}"
    assert sum(iso_weekday(day) >= 6 for day, *_ in log[-14:]) == 4
