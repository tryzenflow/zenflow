from ortools.sat.python import cp_model
from task_var import TaskVar
from models import Constraints


def optimize_function(
  model: cp_model.CpModel,
  task_vars: list[TaskVar],
  constraints: Constraints,
  deadline_weight_factor: dict[str, int],
  min_time=0,
  max_time=24 * 60,
  daily_load=0,
  max_focus_level=3,
  deadline_weight=50,
  optional_task_weight=20,
  energy_weight=5,
  switch_penalty_weight=10,
  overload_weight=5,
  deviation_weight=5,
  min_gap_penalty_weight=10,
  available_hours_penalty_weight=10,
):
  loss_terms = []
  effective_durations = []

  duration_vars = {}
  for task_var in task_vars:
    task, split, start, end, presence = task_var.tuple
    dur = model.NewIntVar(0, max_time, f"dur_{task.id}_{split}")
    # when present: duration = end - start; else 0
    model.Add(dur == end - start).OnlyEnforceIf(presence)
    model.Add(dur == 0).OnlyEnforceIf(presence.Not())
    duration_vars[task_var] = dur

    if task.deadline is not None:
      penalty = model.NewIntVar(0, max_time * deadline_weight,
                                f"deadline_penalty_{task.id}_{split}")
      model.Add(penalty == deadline_weight_factor.get(task.id, 0))
      model.Add(penalty == 0)
      loss_terms.append(penalty)

    # Task priority loss (applied always, even if not present)
    priority_penalty = model.NewIntVar(
      0, 3, f"priority_penalty_{task.id}_{split}")
    model.Add(priority_penalty == task.priority)
    loss_terms.append(priority_penalty)

    if len(task.schedules) > 0 and split < len(task.schedules):
      ref_sched = task.schedules[split]
      ref_start = ref_sched.start
      ref_end = ref_sched.end

      # Start deviation
      dev_start = model.NewIntVar(0, max_time, f"dev_start_{task.id}_{split}")
      diff_start = model.NewIntVar(-max_time, max_time,
                                   f"diff_start_{task.id}_{split}")
      model.Add(diff_start == start - ref_start)
      model.AddAbsEquality(dev_start, diff_start)

      # End deviation
      dev_end = model.NewIntVar(0, max_time, f"dev_end_{task.id}_{split}")
      diff_end = model.NewIntVar(-max_time, max_time,
                                 f"diff_end_{task.id}_{split}")
      model.Add(diff_end == end - ref_end)
      model.AddAbsEquality(dev_end, diff_end)

      # Always penalize deviation, regardless of presence
      penalty = model.NewIntVar(
        0, 2 * max_time * deviation_weight, f"stability_pen_{task.id}_{split}")
      model.Add(penalty == deviation_weight * (dev_start + dev_end))

      loss_terms.append(penalty)

    # ENERGY overlap / penalty (kept from your code)
    for i, block in enumerate(constraints.focus_blocks):
      block_start_const = model.NewConstant(block.interval.start)
      block_end_const = model.NewConstant(block.interval.end)

      overlap = model.NewIntVar(0, task.duration,
                                f"energy_overlap_{task.id}_{split}_{i}")
      latest_start = model.NewIntVar(min_time, max_time,
                                     f"energy_latest_start_{task.id}_{split}_{i}")
      earliest_end = model.NewIntVar(min_time, max_time,
                                     f"energy_earliest_end_{task.id}_{split}_{i}")

      model.AddMaxEquality(latest_start, [start, block_start_const])
      model.AddMinEquality(earliest_end, [end, block_end_const])

      diff = model.NewIntVar(-max_time, max_time, f"energy_diff_{task.id}_{i}")
      model.Add(diff == earliest_end - latest_start)
      model.AddMaxEquality(overlap, [diff, model.NewConstant(0)])

      mismatch = abs(task.focus - block.level)
      if mismatch > 0:
        penalty = model.NewIntVar(0, task.duration * mismatch,
                                  f"energy_penalty_{task.id}_{i}")
        model.Add(penalty == mismatch * overlap).OnlyEnforceIf(presence)
        model.Add(penalty == 0).OnlyEnforceIf(presence.Not())
        loss_terms.append(penalty)
      else:
        bonus = model.NewIntVar(-energy_weight * task.duration, 0,
                                f"energy_bonus_{task.id}_{i}")
        model.Add(bonus == -energy_weight * overlap).OnlyEnforceIf(presence)
        model.Add(bonus == 0).OnlyEnforceIf(presence.Not())
        loss_terms.append(bonus)

    # OPTIONAL task bonus (kept)
    if not task.mandatory:
      bonus = model.NewIntVar(-optional_task_weight, 0,
                              f"bonus_presence_{task.id}")
      model.Add(bonus == -task.priority).OnlyEnforceIf(presence)
      model.Add(bonus == 0).OnlyEnforceIf(presence.Not())
      loss_terms.append(bonus)

    # EFFECTIVE DURATION (for overload)
    if task.focus == max_focus_level:
      eff = model.NewIntVar(0, task.duration, f"eff_dur_{task.id}_{split}")
      model.Add(eff == task.duration).OnlyEnforceIf(presence)
      model.Add(eff == 0).OnlyEnforceIf(presence.Not())
      effective_durations.append(eff)

    # SOFT available_hours penalty (new)
    if constraints.available_hours:
      # compute overlap with all available blocks, then outside = duration - overlap_sum
      overlap_sum_vars = []
      for i, block in enumerate(constraints.available_hours):
        bstart = model.NewConstant(block.start)
        bend = model.NewConstant(block.end)

        latest_start = model.NewIntVar(min_time, max_time,
                                       f"avail_latest_start_{task.id}_{split}_{i}")
        earliest_end = model.NewIntVar(min_time, max_time,
                                       f"avail_earliest_end_{task.id}_{split}_{i}")
        overlap = model.NewIntVar(0, task.duration,
                                  f"avail_overlap_{task.id}_{split}_{i}")

        model.AddMaxEquality(latest_start, [start, bstart])
        model.AddMinEquality(earliest_end, [end, bend])

        diff = model.NewIntVar(-max_time, max_time,
                               f"avail_diff_{task.id}_{split}_{i}")
        model.Add(diff == earliest_end - latest_start)
        model.AddMaxEquality(overlap, [diff, model.NewConstant(0)])

        # zero overlap if not present
        model.Add(overlap == overlap).OnlyEnforceIf(
          presence)  # no-op but keeps var usable
        # to ensure 0 when absent:
        model.Add(overlap == 0).OnlyEnforceIf(presence.Not())

        overlap_sum_vars.append(overlap)

      # sum overlaps
      if overlap_sum_vars:
        total_in_available = model.NewIntVar(0, max_time,
                                             f"total_in_avail_{task.id}_{split}")
        model.Add(total_in_available == sum(overlap_sum_vars))
      else:
        total_in_available = model.NewConstant(0)

      dur_var = duration_vars[task_var]
      outside = model.NewIntVar(
        0, max_time, f"outside_available_{task.id}_{split}")
      # outside = duration - total_in_available, but must be >=0
      model.Add(outside + total_in_available == dur_var)

      # penalty = outside * weight
      avail_pen = model.NewIntVar(0, max_time * available_hours_penalty_weight,
                                  f"avail_penalty_{task.id}_{split}")
      model.Add(avail_pen == outside * available_hours_penalty_weight)
      loss_terms.append(avail_pen)

  # DAILY OVERLOAD (soft) - unchanged
  total_eff = sum(
    effective_durations) if effective_durations else model.NewConstant(0)
  overload = model.NewIntVar(min_time, max_time, "daily_overload")
  model.Add(overload >= total_eff -
            model.NewConstant(constraints.max_daily_load - daily_load))

  overload_penalty = model.NewIntVar(
    min_time, max_time * overload_weight, "overload_penalty")
  model.Add(overload_penalty == overload * overload_weight)
  loss_terms.append(overload_penalty)

  # Batching / context switch (kept as-is)
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
        model.Add(immediate == 1).OnlyEnforceIf(
          [i_before_j, both_present])  # relaxed
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

  # SOFT min-gap penalties between tasks (new)
  # For each pair produce violation variables for both orderings, only active when both present & that ordering.
  n = len(task_vars)
  for i in range(n):
    task_i, split_i, start_i, end_i, pres_i = task_vars[i].tuple
    for j in range(i + 1, n):
      task_j, split_j, start_j, end_j, pres_j = task_vars[j].tuple

      both_present = model.NewBoolVar(f"both_present_min_gap_{i}_{j}")
      model.AddBoolAnd([pres_i, pres_j]).OnlyEnforceIf(both_present)
      model.AddBoolOr([pres_i.Not(), pres_j.Not()]
                      ).OnlyEnforceIf(both_present.Not())

      # orientation boolean: i_before_j
      i_before_j = model.NewBoolVar(f"i_before_j_{i}_{j}")

      # We don't force ordering (soft), but we use these reified constraints to define order when both present.
      # These two reified constraints are consistent with your earlier pattern but now we won't make them hard:
      model.Add(start_j >= end_i).OnlyEnforceIf([i_before_j, both_present])
      model.Add(start_i >= end_j).OnlyEnforceIf(
        [i_before_j.Not(), both_present])

      # compute gap for both orientations
      gap_pos = model.NewIntVar(-max_time, max_time,
                                f"gap_{i}_{j}_pos")  # start_j - end_i
      model.Add(gap_pos == start_j - end_i)
      gap_neg = model.NewIntVar(-max_time, max_time,
                                f"gap_{i}_{j}_neg")  # start_i - end_j
      model.Add(gap_neg == start_i - end_j)

      # violation = max(0, min_gap - gap) when that orientation & both_present
      min_gap_val = constraints.min_gap_between_tasks if hasattr(
        constraints, "min_gap_between_tasks") else 0
      if min_gap_val > 0:
        viol_pos = model.NewIntVar(0, min_gap_val, f"min_gap_viol_{i}_{j}_pos")
        both_and_pos = model.NewBoolVar(f"both_and_pos_{i}_{j}")
        model.AddBoolAnd([both_present, i_before_j]).OnlyEnforceIf(both_and_pos)
        model.AddBoolOr([both_present.Not(), i_before_j.Not()]
                        ).OnlyEnforceIf(both_and_pos.Not())

        # viol_pos >= min_gap - gap_pos, and =0 when not applicable
        model.Add(viol_pos >= min_gap_val - gap_pos).OnlyEnforceIf(both_and_pos)
        model.Add(viol_pos == 0).OnlyEnforceIf(both_and_pos.Not())

        viol_neg = model.NewIntVar(0, min_gap_val, f"min_gap_viol_{i}_{j}_neg")
        both_and_neg = model.NewBoolVar(f"both_and_neg_{i}_{j}")
        model.AddBoolAnd([both_present, i_before_j.Not()]
                         ).OnlyEnforceIf(both_and_neg)
        model.AddBoolOr([both_present.Not(), i_before_j]
                        ).OnlyEnforceIf(both_and_neg.Not())

        model.Add(viol_neg >= min_gap_val - gap_neg).OnlyEnforceIf(both_and_neg)
        model.Add(viol_neg == 0).OnlyEnforceIf(both_and_neg.Not())

        # weight the violations
        pen_pos = model.NewIntVar(
          0, min_gap_val * min_gap_penalty_weight, f"min_gap_pen_pos_{i}_{j}")
        model.Add(pen_pos == viol_pos * min_gap_penalty_weight)
        pen_neg = model.NewIntVar(
          0, min_gap_val * min_gap_penalty_weight, f"min_gap_pen_neg_{i}_{j}")
        model.Add(pen_neg == viol_neg * min_gap_penalty_weight)

        loss_terms.append(pen_pos)
        loss_terms.append(pen_neg)

  # OBJECTIVE
  model.Minimize(sum(loss_terms))
