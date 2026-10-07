"""1000-placement benchmark of the simulator's closed loop (issue #60).

uv run python -m scripts.bench_simulation

One student, the ``single`` scenario, 1000 arrival events per policy. Each
placement is a full place -> react -> learn step (candidate days, vectorized slot
scan, oracle scan, student reaction, production learning rules).
"""

from __future__ import annotations

import time

from src.simulation.archetypes import make_student
from src.simulation.engine import HEURISTIC, SimConfig, World
from src.simulation.world import (
    SCENARIO_BY_NAME,
    build_calendar,
    build_drift,
    build_tasks,
    n_calendar_days,
)

N = 1000


def main() -> None:
    cfg = SimConfig(seed=1, n_events=N, scenarios=("single",))
    profile = make_student(1, 0)
    days = n_calendar_days(N)
    cal = build_calendar(1, 0, days)
    drift = build_drift(1, profile, days)
    tasks = build_tasks(1, 0, SCENARIO_BY_NAME["single"], N)
    print(f"{N} placements, single scenario, UTC, 1 process")
    for policy in (HEURISTIC, "linucb"):
        w = World(cfg, profile, tasks, cal, drift, policy, 0.15, "single")
        t0 = time.perf_counter()
        log = w.run()
        dt = time.perf_counter() - t0
        n = len(log.task_id)
        per_ms = dt / n * 1000
        print(
            f"{policy:<10} {dt:5.2f} s total  {per_ms:5.2f} ms/placement  ({n} placed)"
        )


if __name__ == "__main__":
    main()
