from datetime import datetime
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


def init_deadline_weight(tasks: list[Task]):
  sorted_tasks = sorted(
    [t for t in tasks if t.deadline is not None], key=lambda t: t.deadline)
  deadline_weight_factor = {}
  for i, task in enumerate(sorted_tasks):
    deadline_weight_factor[task.id] = (
      len(sorted_tasks) - i) * 10  # scale factor
  for t in sorted_tasks:
    print(t.id, t.title, t.deadline, deadline_weight_factor[t.id])
  return deadline_weight_factor


def schedule_tasks(tasks: list[Task], constraints: Constraints, min_time=0, max_time=24 * 60, daily_load=0, max_focus_level=3) -> list[tuple[Task, int, Interval]]:
  model = cp_model.CpModel()
  task_vars: list[TaskVar] = []
  intervals = []

  for task in tasks:
    start_min = min_time
    end_max = max_time

    if task.earliest_start is not None:
      start_min = max(start_min, task.earliest_start)
    if task.latest_end is not None:
      end_max = min(end_max, task.latest_end)

    if task.max_splits > 1:
      tvs, ints = build_splittable_task(model, task, start_min, end_max)
    else:
      tvs, ints = build_non_splittable_task(model, task, start_min, end_max)

    task_vars.extend(tvs)
    intervals.extend(ints)

  model.AddNoOverlap(intervals)

  # rest of model...
  deadline_weight_factor = init_deadline_weight(tasks)
  add_prerequisite_constraints(model, task_vars)
  optimize_function(model, task_vars, constraints, deadline_weight_factor,
                    max_time=max_time, daily_load=daily_load, max_focus_level=max_focus_level)
  solver = cp_model.CpSolver()
  solver.parameters.max_time_in_seconds = 10
  status = solver.Solve(model)

  schedule = []
  if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
    for task_var in task_vars:
      if solver.Value(task_var.presence):
        s = solver.Value(task_var.start)
        e = solver.Value(task_var.end)
        schedule.append((task_var.task, task_var.split, Interval(s, e)))
  return schedule
