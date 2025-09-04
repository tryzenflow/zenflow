import math
from ortools.sat.python import cp_model
from models import Task, Constraints, Interval
from optimizer import optimize_function
from task_var import TaskVar


def enforce_multiple_of_5(model: cp_model.CpModel, var: cp_model.IntVar, name: str):
  """Force an IntVar to be a multiple of 5."""
  rem = model.NewIntVar(0, 4, f'rem_{name}')
  model.AddModuloEquality(rem, var, 5)
  model.Add(rem == 0)


def build_splittable_task(model: cp_model.CpModel, task: Task, start_min: int, end_max: int):
  """Create variables and intervals for a splittable task."""
  avg = max(1, task.duration // task.max_splits)
  slack = int(avg * 0.4)
  presences = []
  durations = []
  task_vars = []
  intervals = []

  for k in range(task.max_splits):
    presence = model.NewBoolVar(f'presence_{k}_{task.id}')
    start_time = model.NewIntVar(start_min, end_max, f'start_{k}_{task.id}')
    end_time = model.NewIntVar(start_min, end_max, f'end_{k}_{task.id}')
    duration = model.NewIntVar(1, task.duration, f'duration_{k}_{task.id}')

    enforce_multiple_of_5(model, start_time, f"start_{k}_{task.id}")
    enforce_multiple_of_5(model, duration, f"duration_{k}_{task.id}")

    interval = model.NewOptionalIntervalVar(
        start_time, duration, end_time, presence, f'interval_{k}_{task.id}'
    )

    model.Add(duration >= avg - slack).OnlyEnforceIf(presence)
    model.Add(duration <= avg + slack).OnlyEnforceIf(presence)
    model.Add(end_time == start_time + duration).OnlyEnforceIf(presence)

    task_vars.append(TaskVar(task, k, start_time, end_time, presence))
    intervals.append(interval)
    durations.append(duration)
    presences.append(presence)

  if task.mandatory:
    model.Add(sum(presences) == task.max_splits)
    model.Add(sum(durations) == task.duration)
  else:
    model.Add(sum(presences) <= task.max_splits)
    model.Add(sum(durations) <= task.duration)

  return task_vars, intervals


def build_non_splittable_task(model: cp_model.CpModel, task: Task, start_min: int, end_max: int):
  """Create variables and intervals for a non-splittable task."""
  start_time = model.NewIntVar(
    start_min, end_max - task.duration, f'start_{task.id}')
  end_time = model.NewIntVar(
    start_min + task.duration, end_max, f'end_{task.id}')
  presence = model.NewBoolVar(f'presence_{task.id}')

  enforce_multiple_of_5(model, start_time, f"start_{task.id}")
  # task.duration assumed to already be multiple of 5

  interval = model.NewOptionalIntervalVar(
      start_time, task.duration, end_time, presence, f'interval_{task.id}'
  )
  model.Add(end_time == start_time + task.duration).OnlyEnforceIf(presence)

  if task.mandatory:
    model.Add(presence == 1)

  return [TaskVar(task, 0, start_time, end_time, presence)], [interval]


def add_prerequisite_constraints(model: cp_model.CpModel, task_vars: list[TaskVar]):
  """Enforce prerequisites: task B can start only after task A finishes."""
  task_dict: dict[str, list[TaskVar]] = {}
  for tv in task_vars:
    task_dict.setdefault(tv.task.id, []).append(tv)

  for tv in task_vars:
    for prereq_id in tv.task.prerequisites:
      if prereq_id not in task_dict:
        continue
      for prereq_tv in task_dict[prereq_id]:
        # only if both are present
        both_present = model.NewBoolVar(
          f'both_present_{prereq_id}_{tv.task.id}_{prereq_tv.split}_{tv.split}')
        model.AddBoolAnd([prereq_tv.presence, tv.presence]
                         ).OnlyEnforceIf(both_present)
        model.AddBoolOr([prereq_tv.presence.Not(), tv.presence.Not()]).OnlyEnforceIf(
          both_present.Not())
        model.Add(prereq_tv.end <= tv.start).OnlyEnforceIf(both_present)


def add_min_gap_constraints(model: cp_model.CpModel, task_vars: list[TaskVar], min_gap: int):
  """Enforce min gap between tasks except when both are fixed."""
  for i in range(len(task_vars)):
    for j in range(i + 1, len(task_vars)):
      task_i, split_i, start_i, end_i, pres_i = task_vars[i].tuple
      task_j, split_j, start_j, end_j, pres_j = task_vars[j].tuple

      if task_i.fixed_start is not None and task_j.fixed_start is not None:
        continue

      i_before_j = model.NewBoolVar(
        f'{task_i.id}_{split_i}_before_{task_j.id}_{split_j}')
      both_present = model.NewBoolVar(f'both_present_{i}_{j}')

      model.AddBoolAnd([pres_i, pres_j]).OnlyEnforceIf(both_present)
      model.AddBoolOr([pres_i.Not(), pres_j.Not()]
                      ).OnlyEnforceIf(both_present.Not())

      model.Add(end_i + min_gap <=
                start_j).OnlyEnforceIf([i_before_j, both_present])
      model.Add(end_j + min_gap <=
                start_i).OnlyEnforceIf([i_before_j.Not(), both_present])


def schedule_tasks(tasks: list[Task], constraints: Constraints, min_time=0, max_time=24 * 60):
  model = cp_model.CpModel()
  task_vars: list[TaskVar] = []
  intervals = []

  # ----- build task variables -----
  for task in tasks:
    start_min = min_time
    end_max = max_time

    for block in constraints.available_hours:
      start_min = block.start
      end_max = block.end

      if task.fixed_start is not None:
        start_min = task.fixed_start
        end_max = task.fixed_start + task.duration
      if task.earliest_start is not None:
        start_min = max(start_min, task.earliest_start)
      if task.latest_end is not None:
        end_max = min(end_max, task.latest_end)

    # build task for this interval candidate
    if task.splittable:
      tvs, ints = build_splittable_task(model, task, start_min, end_max)
    else:
      tvs, ints = build_non_splittable_task(model, task, start_min, end_max)

    task_vars.extend(tvs)
    intervals.extend(ints)

  model.AddNoOverlap(intervals)

  # ----- add min gap constraints -----
  add_min_gap_constraints(model, task_vars, constraints.min_gap_between_tasks)

  add_prerequisite_constraints(model, task_vars)

  # ----- soft constraints -----
  optimize_function(model, task_vars, constraints)

  # ----- solve -----
  solver = cp_model.CpSolver()
  solver.parameters.max_time_in_seconds = 10
  status = solver.Solve(model)

  schedule = []
  if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
    for task_var in task_vars:
      if solver.Value(task_var.presence):
        s = solver.Value(task_var.start)
        e = solver.Value(task_var.end)
        schedule.append((task_var.task, Interval(s, e)))

  return schedule
