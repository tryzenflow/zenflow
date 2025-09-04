from ortools.sat.python import cp_model
from task_var import TaskVar
from models import Constraints


def optimize_function(model: cp_model.CpModel, task_vars: list[TaskVar], constraints: Constraints, min_time=0):
  """Soft constraints i.e., violations will be penalized instead of making scheduling impossible"""
  max_time = 24 * 60
  loss_terms = []
  effective_durations = []
  deadline_weight = 20
  optional_task_weight = 10
  energy_weight = 5
  switch_penalty_weight = 10
  overload_weight = 5

  for task_var in task_vars:
    task, split, start_time, end_time, presence = task_var.tuple

    if task.deadline is not None:
      # lateness = max(0, end_time - deadline)
      lateness = model.NewIntVar(
        min_time, max_time, f"lateness_{task.id}_{split}")
      model.Add(lateness >= end_time - task.deadline)
      model.Add(lateness >= 0)

      penalty = model.NewIntVar(min_time, max_time * deadline_weight,
                                f"deadline_penalty_{task.id}_{split}")
      model.Add(penalty == lateness * deadline_weight).OnlyEnforceIf(presence)
      model.Add(penalty == 0).OnlyEnforceIf(presence.Not())
      loss_terms.append(penalty)

    for i, block in enumerate(constraints.energy_blocks):
      overlap = model.NewIntVar(
        0, task.duration, f"energy_overlap_{task.id}_{split}_{i}")
      latest_start = model.NewIntVar(
        min_time, max_time, f"energy_latest_start_{task.id}_{split}_{i}")
      earliest_end = model.NewIntVar(
        min_time, max_time, f"energy_earliest_end_{task.id}_{split}_{i}")

      model.AddMaxEquality(latest_start, [start_time, block.interval.start])
      model.AddMinEquality(earliest_end, [end_time, block.interval.end])
      diff = model.NewIntVar(-max_time, max_time, f"energy_diff_{task.id}_{i}")
      model.Add(diff == earliest_end - latest_start)
      model.AddMaxEquality(overlap, [diff, model.NewConstant(0)])

      mismatch = abs(task.energy_level - block.energy_level)
      if mismatch > 0:
        penalty = model.NewIntVar(
          0, task.duration * mismatch, f"energy_penalty_{task.id}_{i}")
        model.Add(penalty == mismatch * overlap).OnlyEnforceIf(presence)
        model.Add(penalty == 0).OnlyEnforceIf(presence.Not())
        loss_terms.append(penalty)
      else:
        bonus = model.NewIntVar(-energy_weight * task.duration, 0,
                                f"energy_bonus_{task.id}_{i}")
        model.Add(bonus == -energy_weight * overlap).OnlyEnforceIf(presence)
        model.Add(bonus == 0).OnlyEnforceIf(presence.Not())
        loss_terms.append(bonus)

    # ---------- OPTIONAL TASK BONUS ----------
    if not task.mandatory:
      bonus = model.NewIntVar(-optional_task_weight, 0,
                              f"bonus_presence_{task.id}")
      model.Add(bonus == -task.priority).OnlyEnforceIf(presence)
      model.Add(bonus == 0).OnlyEnforceIf(presence.Not())
      loss_terms.append(bonus)

    # ---------- MAX DAILY LOAD ----------
    effective_duration = model.NewIntVar(
        0, task.duration, f"eff_dur_{task.id}_{split}")
    model.Add(effective_duration == task.duration).OnlyEnforceIf(presence)
    model.Add(effective_duration == 0).OnlyEnforceIf(presence.Not())

    effective_durations.append(effective_duration)

  overload = model.NewIntVar(min_time, 24 * 60, "daily_overload")
  model.Add(overload >= sum(effective_durations) - constraints.max_daily_load)
  loss_terms.append(overload * overload_weight)

  # ---------- BATCHING (CONTEXT SWITCH) ----------
  if constraints.batch_similar_tasks:
    n = len(task_vars)
    for i in range(n):
      task_i, split_i, start_i, end_i, pres_i = task_vars[i].tuple
      for j in range(i + 1, n):
        task_j, split_j, start_j, end_j, pres_j = task_vars[j].tuple

        both_present = model.NewBoolVar(
          f"{task_i.id}_{split_i}_and_{task_j.id}_{split_j}_present")
        model.AddBoolAnd([pres_i, pres_j]).OnlyEnforceIf(both_present)

        # i_before_j ordering
        i_before_j = model.NewBoolVar(
          f"{task_i.id}_{split_i}_before_{task_j.id}_{split_j}")
        model.Add(start_j >= end_i).OnlyEnforceIf([i_before_j, both_present])
        model.Add(start_i >= end_j).OnlyEnforceIf(
          [i_before_j.Not(), both_present])

        # immediate successor var
        immediate = model.NewBoolVar(
          f"{task_i.id}_{split_i}_immediately_before_{task_j.id}_{split_j}")
        model.Add(immediate == 1).OnlyEnforceIf([i_before_j, both_present])
        model.Add(immediate == 0).OnlyEnforceIf(i_before_j.Not())

        # context switch penalty/reward
        if task_i.category != task_j.category:
          penalty = model.NewIntVar(
            0, switch_penalty_weight, f"switch_penalty_{i}_{j}")
          model.Add(penalty == switch_penalty_weight).OnlyEnforceIf(immediate)
          model.Add(penalty == 0).OnlyEnforceIf(immediate.Not())
          loss_terms.append(penalty)
        else:
          reward = model.NewIntVar(-switch_penalty_weight,
                                   0, f"batch_reward_{i}_{j}")
          model.Add(reward == -switch_penalty_weight).OnlyEnforceIf(immediate)
          model.Add(reward == 0).OnlyEnforceIf(immediate.Not())
          loss_terms.append(reward)

  # ---------- OBJECTIVE ----------
  model.Minimize(sum(loss_terms))
