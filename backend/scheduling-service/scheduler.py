from datetime import datetime
from typing import List

from models import (
    TIME_GRANULARITY,
    Interval,
    Task,
    UserPreference,
)
from optimizer import optimize_function
from ortools.sat.python import cp_model


def enforce_multiple_of_time_granularity(model: cp_model.CpModel, var: cp_model.IntVar):
    rem = model.NewIntVar(0, TIME_GRANULARITY - 1, "")
    model.AddModuloEquality(rem, var, TIME_GRANULARITY)
    model.Add(rem == 0)


def nearest_multiple_of_time_granularity(value: int) -> int:
    return round(value / TIME_GRANULARITY) * TIME_GRANULARITY


def build_task(
    model: cp_model.CpModel,
    task: Task,
    start_min: int,
    end_max: int,
):
    presences = []
    intervals = []
    task_vars = []

    for k in range(task.max_splits):
        presence = model.NewBoolVar(f"presence_{task.id}_{k}")

        start = model.NewIntVar(start_min, end_max, f"start_{task.id}_{k}")

        # Each split can be 0 if unused, or any multiple of TIME_GRANULARITY up to task.duration
        duration = model.NewIntVar(0, task.duration, f"dur_{task.id}_{k}")
        end = model.NewIntVar(start_min, end_max, f"end_{task.id}_{k}")

        # enforce multiples of TIME_GRANULARITY
        enforce_multiple_of_time_granularity(model, start)
        enforce_multiple_of_time_granularity(model, duration)

        # Only enforce minimum nonzero split if the split is selected
        min_split = nearest_multiple_of_time_granularity(
            task.duration // task.max_splits
        )
        model.Add(duration >= min_split).OnlyEnforceIf(presence)
        model.Add(duration == 0).OnlyEnforceIf(presence.Not())

        model.Add(end == start + duration).OnlyEnforceIf(presence)

        interval = model.NewOptionalIntervalVar(
            start, duration, end, presence, f"interval_{task.id}_{k}"
        )

        presences.append(presence)
        intervals.append(interval)
        task_vars.append((task, k, start, end, duration, presence))

    # total scheduled ≤ task.duration
    model.Add(sum(d for *_, d, _ in task_vars) <= task.duration)

    return task_vars, intervals


def add_hard_available_hours(
    model: cp_model.CpModel,
    start,
    end,
    presence,
    available_hours: List[Interval],
):
    inside_any = []
    for i, block in enumerate(available_hours):
        inside = model.NewBoolVar(f"inside_avail_{i}")
        model.Add(start >= block.start).OnlyEnforceIf(inside)
        model.Add(end <= block.end).OnlyEnforceIf(inside)
        inside_any.append(inside)

    model.AddBoolOr(inside_any).OnlyEnforceIf(presence)


def schedule_tasks(
    tasks: List[Task],
    pref: UserPreference,
    min_time=0,
    max_time=24 * 60,
):
    model = cp_model.CpModel()

    all_intervals = []
    all_task_vars = []

    # Deadline weighting (earlier deadlines are more important)
    now = datetime.now()
    for task in tasks:
        if task.deadline:
            task.deadline_weight = max(
                0, int((task.deadline - now).total_seconds() // 60)
            )

    for task in tasks:
        task_vars, intervals = build_task(model, task, min_time, max_time)
        all_task_vars.extend(task_vars)
        all_intervals.extend(intervals)

    model.AddNoOverlap(all_intervals)

    for task, _, start, end, _, presence in all_task_vars:
        add_hard_available_hours(model, start, end, presence, pref.available_hours)

    optimize_function(model, all_task_vars, pref, max_time=max_time)

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 5
    status = solver.Solve(model)

    schedule = []
    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        for task, split, start, end, _, presence in all_task_vars:
            if solver.Value(presence):
                block = Interval(
                    solver.Value(start),
                    solver.Value(end),
                )
                schedule.append((task, split, block))

    return schedule
