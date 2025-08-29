from ortools.sat.python import cp_model
from task_var import TaskVar
from models import Constraints


def optimize_function(model: cp_model.CpModel, task_vars: list[TaskVar], constraints: Constraints):
  max_time = 24 * 60
  loss_terms = []

  # ---------- ENERGY ALIGNMENT ----------
  for task_var in task_vars:
    task, split, start_time, end_time, presence = task_var.tuple

    for i, block in enumerate(constraints.energy_blocks):
      overlap = model.NewIntVar(
        0, task.duration, f"energy_overlap_{task.id}_{split}_{i}")
      latest_start = model.NewIntVar(
        0, max_time, f"energy_latest_start_{task.id}_{split}_{i}")
      earliest_end = model.NewIntVar(
        0, max_time, f"energy_earliest_end_{task.id}_{split}_{i}")

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
        bonus = model.NewIntVar(-5 * task.duration, 0,
                                f"energy_bonus_{task.id}_{i}")
        model.Add(bonus == -5 * overlap).OnlyEnforceIf(presence)
        model.Add(bonus == 0).OnlyEnforceIf(presence.Not())
        loss_terms.append(bonus)

    # ---------- OPTIONAL TASK BONUS ----------
    if not task.mandatory:
      bonus = model.NewIntVar(-10, 0, f"bonus_presence_{task.id}")
      model.Add(bonus == -task.priority).OnlyEnforceIf(presence)
      model.Add(bonus == 0).OnlyEnforceIf(presence.Not())
      loss_terms.append(bonus)

  # ---------- BATCHING (CONTEXT SWITCH) ----------
  n = len(task_vars)
  switch_penalty_weight = 10
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
