from ortools.sat.python import cp_model
from task_var import TaskVar
from models import Constraints


def optimize_function(model: cp_model.CpModel, task_vars: list[TaskVar], constraints: Constraints, deadline_weight_factor: dict[str, int], min_time=0):
  max_energy_level = 3
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
      # convert deadline datetime → priority weight
      # earlier deadlines produce higher penalty weight
      # we normalize: lower datetime → higher priority
      # e.g., earliest_deadline = min(task.deadline for all tasks)
      # this mapping can be done outside CP-SAT, resulting in 'deadline_weight_factor'

      penalty = model.NewIntVar(
          0, max_time * deadline_weight,
          f"deadline_penalty_{task.id}_{split}"
      )
      # apply the penalty only if task is present
      # for soft prioritization, we just assign precomputed weight
      model.Add(penalty == deadline_weight_factor[task.id]).OnlyEnforceIf(
        presence)
      model.Add(penalty == 0).OnlyEnforceIf(presence.Not())
      loss_terms.append(penalty)
    # ENERGY overlap / penalty
    for i, block in enumerate(constraints.energy_blocks):
      # create constants for block bounds
      block_start_const = model.NewConstant(block.interval.start)
      block_end_const = model.NewConstant(block.interval.end)

      overlap = model.NewIntVar(
        0, task.duration, f"energy_overlap_{task.id}_{split}_{i}")
      latest_start = model.NewIntVar(
        min_time, max_time, f"energy_latest_start_{task.id}_{split}_{i}")
      earliest_end = model.NewIntVar(
        min_time, max_time, f"energy_earliest_end_{task.id}_{split}_{i}")

      # max(latest_start, start_time, block_start_const) == latest_start
      model.AddMaxEquality(latest_start, [start_time, block_start_const])
      # min(earliest_end, end_time, block_end_const) == earliest_end
      model.AddMinEquality(earliest_end, [end_time, block_end_const])

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
        bonus = model.NewIntVar(-energy_weight * task.duration,
                                0, f"energy_bonus_{task.id}_{i}")
        model.Add(bonus == -energy_weight * overlap).OnlyEnforceIf(presence)
        model.Add(bonus == 0).OnlyEnforceIf(presence.Not())
        loss_terms.append(bonus)

    # OPTIONAL task bonus
    if not task.mandatory:
      bonus = model.NewIntVar(-optional_task_weight, 0,
                              f"bonus_presence_{task.id}")
      model.Add(bonus == -task.priority).OnlyEnforceIf(presence)
      model.Add(bonus == 0).OnlyEnforceIf(presence.Not())
      loss_terms.append(bonus)

    # EFFECTIVE DURATION (for overload)
    if task.energy_level == max_energy_level:
      eff = model.NewIntVar(0, task.duration, f"eff_dur_{task.id}_{split}")
      model.Add(eff == task.duration).OnlyEnforceIf(presence)
      model.Add(eff == 0).OnlyEnforceIf(presence.Not())
      effective_durations.append(eff)

  # DAILY OVERLOAD (soft)
  total_eff = sum(
    effective_durations) if effective_durations else model.NewConstant(0)
  overload = model.NewIntVar(0, 24 * 60, "daily_overload")
  # overload >= total_eff - max_daily_load
  model.Add(overload >= total_eff -
            model.NewConstant(constraints.max_daily_load))
  loss_terms.append(model.NewIntVar(
    0, 24 * 60 * overload_weight, "overload_scaled"))  # placeholder

  # To properly multiply the overload by weight, we need an IntVar:
  overload_penalty = model.NewIntVar(
    0, 24 * 60 * overload_weight, "overload_penalty")
  model.Add(overload_penalty == overload * overload_weight)
  loss_terms.append(overload_penalty)

  # Batching / context switch
  if constraints.batch_similar_tasks:
    n = len(task_vars)
    for i in range(n):
      task_i, split_i, start_i, end_i, pres_i = task_vars[i].tuple
      for j in range(i + 1, n):
        task_j, split_j, start_j, end_j, pres_j = task_vars[j].tuple
        both_present = model.NewBoolVar(
          f"{task_i.id}_{split_i}_and_{task_j.id}_{split_j}_present")
        model.AddBoolAnd([pres_i, pres_j]).OnlyEnforceIf(both_present)
        model.AddBoolOr([pres_i.Not(), pres_j.Not()]
                        ).OnlyEnforceIf(both_present.Not())

        i_before_j = model.NewBoolVar(
          f"{task_i.id}_{split_i}_before_{task_j.id}_{split_j}")
        model.Add(start_j >= end_i).OnlyEnforceIf([i_before_j, both_present])
        model.Add(start_i >= end_j).OnlyEnforceIf(
          [i_before_j.Not(), both_present])

        immediate = model.NewBoolVar(
          f"{task_i.id}_{split_i}_immediately_before_{task_j.id}_{split_j}")
        # immediate implies i_before_j and end_i == start_j; since equality is tricky, keep a relaxed version:
        model.Add(immediate == 1).OnlyEnforceIf(
          [i_before_j, both_present])  # conservative
        model.Add(immediate == 0).OnlyEnforceIf(i_before_j.Not())

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

  # OBJECTIVE
  model.Minimize(sum(loss_terms))
