from collections import defaultdict
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
    if task.fixed_window is None:
        for k in range(task.max_splits):
            presence = model.NewBoolVar(f"presence_{task.id}_{k}")
            if k == 0:
                model.Add(presence == 1)

            start = model.NewIntVar(start_min, end_max, f"start_{task.id}_{k}")

            # Each split can be 0 if unused, or any multiple of TIME_GRANULARITY up to task.duration
            duration = model.NewIntVar(
                TIME_GRANULARITY, task.duration, f"dur_{task.id}_{k}"
            )
            end = model.NewIntVar(start_min, end_max, f"end_{task.id}_{k}")
            if task.deadline and task.deadline < end_max:
                model.Add(end <= task.deadline).OnlyEnforceIf(presence)

            # enforce multiples of TIME_GRANULARITY
            enforce_multiple_of_time_granularity(model, start)
            enforce_multiple_of_time_granularity(model, duration)

            # Only enforce minimum nonzero split if the split is selected
            min_split = nearest_multiple_of_time_granularity(
                task.duration // task.max_splits
            )
            if task.scheduled_blocks:
                min_split = min(
                    [block.end - block.start for block in task.scheduled_blocks]
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

        model.Add(sum(d for *_, d, _ in task_vars) == task.duration)
    else:
        start_lb = task.fixed_window.start
        end_ub = task.fixed_window.end - task.duration
        start = model.NewIntVar(start_lb, end_ub, f"start_{task.id}")
        duration = model.NewIntVar(
            task.duration, task.duration, f"dur_{task.id}"
        )  # no splitting for fixed_window
        end = model.NewIntVar(
            start_lb + task.duration,
            task.fixed_window.end if task.fixed_window else end_max,
            f"end_{task.id}",
        )
        model.Add(end == start + duration)
        presence = model.NewBoolVar(f"presence_{task.id}")
        model.Add(presence == 1)

        interval = model.NewOptionalIntervalVar(
            start, duration, end, presence, f"interval_{task.id}"
        )
        presences.append(presence)
        intervals.append(interval)
        task_vars.append((task, 0, start, end, duration, presence))

    return task_vars, intervals


def schedule_tasks(
    tasks: List[Task],
    pref: UserPreference,
    min_time=0,
    max_time=24 * 60,
):
    model = cp_model.CpModel()

    all_intervals = []
    all_task_vars = []

    for task in tasks:
        task_vars, intervals = build_task(model, task, min_time, max_time)
        all_task_vars.extend(task_vars)
        all_intervals.extend(intervals)

    model.AddNoOverlap(all_intervals)

    optimize_function(model, all_task_vars, pref, max_time=max_time)

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 5
    status = solver.Solve(model)

    schedule = []
    splits_per_task = defaultdict(int)
    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        for task, _, start, end, _, presence in all_task_vars:
            if solver.Value(presence):
                block = Interval(
                    solver.Value(start),
                    solver.Value(end),
                )
                split_index = splits_per_task[task]
                splits_per_task[task] += 1
                schedule.append((task, split_index, block))
    return schedule
