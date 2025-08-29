import math
from ortools.sat.python import cp_model
from models import Task, Constraints, Interval
from optimizer import optimize_function
from task_var import TaskVar


def schedule_tasks(tasks: list[Task], constraints: Constraints):
  model = cp_model.CpModel()
  task_vars: list[TaskVar] = []
  intervals = []

  for task in tasks:
    start_min = constraints.available_hours.start
    end_max = constraints.available_hours.end

    if task.fixed_start is not None:
      start_min = task.fixed_start
      end_max = task.fixed_start + task.duration
    if task.earliest_start is not None:
      start_min = max(start_min, task.earliest_start)
    if task.latest_end is not None:
      end_max = min(end_max, task.latest_end)

    if task.splittable:
      avg = max(1, task.duration // task.max_splits)
      slack = math.isqrt(avg)
      presences = []
      durations: list[cp_model.IntVar] = []

      for k in range(task.max_splits):
        presence = model.NewBoolVar(f'presence_{k}_{task.id}')
        start_time = model.NewIntVar(start_min, end_max, f'start_{k}_{task.id}')
        end_time = model.NewIntVar(start_min, end_max, f'end_{k}_{task.id}')
        duration = model.NewIntVar(1, task.duration, f'duration_{k}_{task.id}')

        # enforce multiples of 5
        rem_start = model.NewIntVar(0, 4, f'rem_start_{k}_{task.id}')
        model.AddModuloEquality(rem_start, start_time, 5)
        model.Add(rem_start == 0)

        rem_dur = model.NewIntVar(0, 4, f'rem_dur_{k}_{task.id}')
        model.AddModuloEquality(rem_dur, duration, 5)
        model.Add(rem_dur == 0)

        interval = model.NewOptionalIntervalVar(
          start_time, duration, end_time, presence, f'interval_{k}_{task.id}'
        )

        durations.append(duration)
        model.Add(duration >= avg - slack).OnlyEnforceIf(presence)
        model.Add(duration <= avg + slack).OnlyEnforceIf(presence)
        model.Add(end_time == start_time + duration).OnlyEnforceIf(presence)

        task_vars.append(TaskVar(task, k, start_time, end_time, presence))
        intervals.append(interval)
        presences.append(presence)

      if task.mandatory:
        model.Add(sum(presences) == task.max_splits)
        model.Add(sum(durations) == task.duration)
      else:
        model.Add(sum(presences) <= task.max_splits)
        model.Add(sum(durations) <= task.duration)

    else:
      start_time = model.NewIntVar(
        start_min, end_max - task.duration, f'start_{task.id}')
      end_time = model.NewIntVar(
        start_min + task.duration, end_max, f'end_{task.id}')
      presence = model.NewBoolVar(f'presence_{task.id}')

      rem_start = model.NewIntVar(0, 4, f'rem_start_{task.id}')
      model.AddModuloEquality(rem_start, start_time, 5)
      model.Add(rem_start == 0)

      rem_dur = model.NewIntVar(0, 4, f'rem_dur_{task.id}')
      model.AddModuloEquality(rem_dur, task.duration, 5)

      interval = model.NewOptionalIntervalVar(
        start_time, task.duration, end_time, presence, f'interval_{task.id}'
      )
      model.Add(end_time == start_time + task.duration).OnlyEnforceIf(presence)

      if task.mandatory:
        model.Add(presence == 1)

      task_vars.append(TaskVar(task, 0, start_time, end_time, presence))
      intervals.append(interval)

  # no overlap
  model.AddNoOverlap(intervals)

  # buffer between tasks
  min_gap = constraints.rest_period.min_gap
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

  # soft constraints
  optimize_function(model, task_vars, constraints)

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
