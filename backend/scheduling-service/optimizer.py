from typing import Dict, List

from models import Constraints
from ortools.sat.python import cp_model
from task_var import TaskVar


def penalty_scale(task):
    return 1 if task.mandatory else 0.2  # optional tasks are 5× cheaper


def reward_scale(task):
    return 1 if task.mandatory else 1


def optimize_function(
    model: cp_model.CpModel,
    task_vars: List[TaskVar],
    constraints: Constraints,
    deadline_weight_factor: Dict[str, int],
    min_time=0,
    max_time=24 * 60,
    daily_load=0,
    max_focus_level=3,
    # Concrete default weights to try
    optional_task_weight=400,
    energy_weight=250,
    available_hours_penalty_weight=400,
    overload_weight=350,
    deviation_weight=150,
    min_gap_penalty_weight=150,
    switch_penalty_weight=150,
):
    loss_terms = []
    effective_durations = []

    # map TaskVar -> duration var
    duration_vars = {}

    for task_var in task_vars:
        task, split, start, end, presence = task_var.tuple

        # Duration variable: 0 if absent, else end - start
        dur = model.NewIntVar(0, max_time, f"dur_{task.id}_{split}")
        model.Add(dur == end - start).OnlyEnforceIf(presence)
        model.Add(dur == 0).OnlyEnforceIf(presence.Not())
        duration_vars[task_var] = dur

        # DEADLINE penalty: apply a (constant) penalty when scheduled (if a deadline exists)
        if task.deadline is not None:
            penalty_val = int(deadline_weight_factor.get(task.id, 0))
            if penalty_val > 0:
                penalty = model.NewIntVar(
                    0, penalty_val, f"deadline_penalty_{task.id}_{split}"
                )
                # apply only when present
                model.Add(penalty == penalty_val).OnlyEnforceIf(presence)
                model.Add(penalty == 0).OnlyEnforceIf(presence.Not())
                loss_terms.append(penalty)

        # Task priority penalty: penalize scheduling lower-priority number (higher priority)
        # NOTE: priority scale in Task is 1-3 (lower = more important). We convert to a penalty
        # where larger number = worse. Using (4 - priority) gives higher penalty to lower priority tasks.
        # Apply only when present.

        if task.mandatory:
            priority_penalty = model.NewIntVar(
                0, 3, f"priority_penalty_{task.id}_{split}"
            )
            model.Add(priority_penalty == (4 - task.priority)).OnlyEnforceIf(presence)
            model.Add(priority_penalty == 0).OnlyEnforceIf(presence.Not())
            loss_terms.append(priority_penalty)

        # Stability / deviation from reference schedule (if a ref exists for this split)
        if len(task.schedules) > 0 and split < len(task.schedules):
            ref_sched = task.schedules[split]
            ref_start = ref_sched.start
            ref_end = ref_sched.end

            # Start deviation
            dev_start = model.NewIntVar(0, max_time, f"dev_start_{task.id}_{split}")
            diff_start = model.NewIntVar(
                -max_time, max_time, f"diff_start_{task.id}_{split}"
            )
            model.Add(diff_start == start - ref_start)
            model.AddAbsEquality(dev_start, diff_start)

            # End deviation
            dev_end = model.NewIntVar(0, max_time, f"dev_end_{task.id}_{split}_end")
            diff_end = model.NewIntVar(
                -max_time, max_time, f"diff_end_{task.id}_{split}"
            )
            model.Add(diff_end == end - ref_end)
            model.AddAbsEquality(dev_end, diff_end)

            # Penalize deviation only when the split is present
            stability_pen = model.NewIntVar(
                0, 2 * max_time * deviation_weight, f"stability_pen_{task.id}_{split}"
            )
            model.Add(
                stability_pen == deviation_weight * (dev_start + dev_end)
            ).OnlyEnforceIf(presence)
            model.Add(stability_pen == 0).OnlyEnforceIf(presence.Not())
            loss_terms.append(stability_pen)

        # ENERGY overlap with focus blocks
        for i, block in enumerate(constraints.focus_blocks):
            block_start_const = model.NewConstant(block.interval.start)
            block_end_const = model.NewConstant(block.interval.end)

            overlap = model.NewIntVar(
                0, task.duration, f"energy_overlap_{task.id}_{split}_{i}"
            )
            latest_start = model.NewIntVar(
                min_time, max_time, f"energy_latest_start_{task.id}_{split}_{i}"
            )
            earliest_end = model.NewIntVar(
                min_time, max_time, f"energy_earliest_end_{task.id}_{split}_{i}"
            )

            model.AddMaxEquality(latest_start, [start, block_start_const])
            model.AddMinEquality(earliest_end, [end, block_end_const])

            diff = model.NewIntVar(
                -max_time, max_time, f"energy_diff_{task.id}_{split}_{i}"
            )
            model.Add(diff == earliest_end - latest_start)
            model.AddMaxEquality(overlap, [diff, model.NewConstant(0)])

            # zero overlap if not present
            model.Add(overlap == overlap).OnlyEnforceIf(
                presence
            )  # harmless keep: var usable when present
            model.Add(overlap == 0).OnlyEnforceIf(presence.Not())

            mismatch = abs(task.focus - block.level)
            if mismatch > 0:
                # penalty proportional to overlap and mismatch; only when present
                penalty = model.NewIntVar(
                    0,
                    task.duration * mismatch * energy_weight,
                    f"energy_penalty_{task.id}_{split}_{i}",
                )
                scale = int(energy_weight * penalty_scale(task))
                model.Add(penalty == mismatch * overlap * scale).OnlyEnforceIf(presence)
                model.Add(penalty == 0).OnlyEnforceIf(presence.Not())
                loss_terms.append(penalty)
            else:
                # reward (negative term) for matching focus level
                bonus = model.NewIntVar(
                    -energy_weight * task.duration,
                    0,
                    f"energy_bonus_{task.id}_{split}_{i}",
                )
                model.Add(bonus == -energy_weight * overlap).OnlyEnforceIf(presence)
                model.Add(bonus == 0).OnlyEnforceIf(presence.Not())
                loss_terms.append(bonus)

        # OPTIONAL task bonus (reward) -- per-split var name and conditional on presence

        if not task.mandatory:
            dur = duration_vars[task_var]

            bonus = model.NewIntVar(
                -optional_task_weight * task.duration,
                0,
                f"optional_bonus_{task.id}_{split}",
            )

            model.Add(
                bonus == -optional_task_weight * dur * (4 - task.priority)
            ).OnlyEnforceIf(presence)

            model.Add(bonus == 0).OnlyEnforceIf(presence.Not())
            loss_terms.append(bonus)

        # EFFECTIVE DURATION (for overload): only full duration for max_focus_level tasks
        if task.focus == max_focus_level:
            eff = model.NewIntVar(0, task.duration, f"eff_dur_{task.id}_{split}")
            model.Add(eff == task.duration).OnlyEnforceIf(presence)
            model.Add(eff == 0).OnlyEnforceIf(presence.Not())
            effective_durations.append(eff)

        # SOFT available_hours penalty: compute minutes outside available blocks and penalize per-minute
        if constraints.available_hours:
            overlap_sum_vars = []
            for i, block in enumerate(constraints.available_hours):
                bstart = model.NewConstant(block.start)
                bend = model.NewConstant(block.end)

                latest_start = model.NewIntVar(
                    min_time, max_time, f"avail_latest_start_{task.id}_{split}_{i}"
                )
                earliest_end = model.NewIntVar(
                    min_time, max_time, f"avail_earliest_end_{task.id}_{split}_{i}"
                )
                overlap = model.NewIntVar(
                    0, task.duration, f"avail_overlap_{task.id}_{split}_{i}"
                )

                model.AddMaxEquality(latest_start, [start, bstart])
                model.AddMinEquality(earliest_end, [end, bend])

                diff = model.NewIntVar(
                    -max_time, max_time, f"avail_diff_{task.id}_{split}_{i}"
                )
                model.Add(diff == earliest_end - latest_start)
                model.AddMaxEquality(overlap, [diff, model.NewConstant(0)])

                model.Add(overlap == overlap).OnlyEnforceIf(
                    presence
                )  # keep usable if present
                model.Add(overlap == 0).OnlyEnforceIf(presence.Not())

                overlap_sum_vars.append(overlap)

            if overlap_sum_vars:
                total_in_available = model.NewIntVar(
                    0, max_time, f"total_in_avail_{task.id}_{split}"
                )
                model.Add(total_in_available == sum(overlap_sum_vars))
            else:
                total_in_available = model.NewConstant(0)

            dur_var = duration_vars[task_var]
            outside = model.NewIntVar(
                0, max_time, f"outside_available_{task.id}_{split}"
            )
            model.Add(outside + total_in_available == dur_var)

            avail_pen = model.NewIntVar(
                0,
                max_time * available_hours_penalty_weight,
                f"avail_penalty_{task.id}_{split}",
            )

            scale = int(available_hours_penalty_weight * penalty_scale(task))
            model.Add(avail_pen == outside * scale)

            loss_terms.append(avail_pen)

    # DAILY OVERLOAD (soft)
    total_eff = (
        sum(effective_durations) if effective_durations else model.NewConstant(0)
    )
    overload = model.NewIntVar(0, max_time, "daily_overload")
    # overload >= max(0, total_eff - allowed)
    allowed = max(0, constraints.max_daily_load - daily_load)
    model.Add(overload >= total_eff - model.NewConstant(allowed))
    model.Add(overload >= 0)

    overload_penalty = model.NewIntVar(
        0, max_time * overload_weight, "overload_penalty"
    )
    model.Add(overload_penalty == overload * overload_weight)
    loss_terms.append(overload_penalty)

    # Batching / context switch: prefer similar categories and reward immediate adjacency
    if constraints.batch_similar_tasks:
        n = len(task_vars)
        for i in range(n):
            task_i, split_i, start_i, end_i, pres_i = task_vars[i].tuple
            for j in range(i + 1, n):
                task_j, split_j, start_j, end_j, pres_j = task_vars[j].tuple
                both_present = model.NewBoolVar(
                    f"{task_i.id}_{split_i}_and_{task_j.id}_{split_j}_present"
                )
                model.AddBoolAnd([pres_i, pres_j]).OnlyEnforceIf(both_present)
                model.AddBoolOr([pres_i.Not(), pres_j.Not()]).OnlyEnforceIf(
                    both_present.Not()
                )

                i_before_j = model.NewBoolVar(
                    f"{task_i.id}_{split_i}_before_{task_j.id}_{split_j}"
                )
                # Define ordering only when both present
                model.Add(start_j >= end_i).OnlyEnforceIf([i_before_j, both_present])
                model.Add(start_i >= end_j).OnlyEnforceIf(
                    [i_before_j.Not(), both_present]
                )

                immediate = model.NewBoolVar(
                    f"{task_i.id}_{split_i}_immediately_before_{task_j.id}_{split_j}"
                )
                # immediate can be 1 only if i_before_j and both_present; otherwise 0.
                model.Add(immediate == 1).OnlyEnforceIf([i_before_j, both_present])
                model.Add(immediate == 0).OnlyEnforceIf(
                    [i_before_j.Not(), both_present]
                )
                model.Add(immediate == 0).OnlyEnforceIf(both_present.Not())
                scale = int(switch_penalty_weight * penalty_scale(task_i))
                if task_i.category != task_j.category:
                    penalty = model.NewIntVar(0, scale, f"switch_penalty_{i}_{j}")
                    model.Add(penalty == scale).OnlyEnforceIf(immediate)
                    model.Add(penalty == 0).OnlyEnforceIf(immediate.Not())
                    loss_terms.append(penalty)
                else:
                    reward = model.NewIntVar(-scale, 0, f"batch_reward_{i}_{j}")
                    model.Add(reward == -scale).OnlyEnforceIf(immediate)
                    model.Add(reward == 0).OnlyEnforceIf(immediate.Not())
                    loss_terms.append(reward)

    # SOFT min-gap penalties between tasks
    n = len(task_vars)
    for i in range(n):
        task_i, split_i, start_i, end_i, pres_i = task_vars[i].tuple
        for j in range(i + 1, n):
            task_j, split_j, start_j, end_j, pres_j = task_vars[j].tuple

            both_present = model.NewBoolVar(f"both_present_min_gap_{i}_{j}")
            model.AddBoolAnd([pres_i, pres_j]).OnlyEnforceIf(both_present)
            model.AddBoolOr([pres_i.Not(), pres_j.Not()]).OnlyEnforceIf(
                both_present.Not()
            )

            # orientation boolean: i_before_j
            i_before_j = model.NewBoolVar(f"i_before_j_{i}_{j}")

            # define (soft) order when both present
            model.Add(start_j >= end_i).OnlyEnforceIf([i_before_j, both_present])
            model.Add(start_i >= end_j).OnlyEnforceIf([i_before_j.Not(), both_present])

            gap_pos = model.NewIntVar(-max_time, max_time, f"gap_{i}_{j}_pos")
            model.Add(gap_pos == start_j - end_i)
            gap_neg = model.NewIntVar(-max_time, max_time, f"gap_{i}_{j}_neg")
            model.Add(gap_neg == start_i - end_j)

            min_gap_val = getattr(constraints, "min_gap_between_tasks", 0)
            if min_gap_val > 0:
                viol_pos = model.NewIntVar(0, min_gap_val, f"min_gap_viol_{i}_{j}_pos")
                both_and_pos = model.NewBoolVar(f"both_and_pos_{i}_{j}")
                model.AddBoolAnd([both_present, i_before_j]).OnlyEnforceIf(both_and_pos)
                model.AddBoolOr([both_present.Not(), i_before_j.Not()]).OnlyEnforceIf(
                    both_and_pos.Not()
                )

                model.Add(viol_pos >= min_gap_val - gap_pos).OnlyEnforceIf(both_and_pos)
                model.Add(viol_pos == 0).OnlyEnforceIf(both_and_pos.Not())

                viol_neg = model.NewIntVar(0, min_gap_val, f"min_gap_viol_{i}_{j}_neg")
                both_and_neg = model.NewBoolVar(f"both_and_neg_{i}_{j}")
                model.AddBoolAnd([both_present, i_before_j.Not()]).OnlyEnforceIf(
                    both_and_neg
                )
                model.AddBoolOr([both_present.Not(), i_before_j]).OnlyEnforceIf(
                    both_and_neg.Not()
                )

                model.Add(viol_neg >= min_gap_val - gap_neg).OnlyEnforceIf(both_and_neg)
                model.Add(viol_neg == 0).OnlyEnforceIf(both_and_neg.Not())

                pen_pos = model.NewIntVar(
                    0, min_gap_val * min_gap_penalty_weight, f"min_gap_pen_pos_{i}_{j}"
                )
                pen_neg = model.NewIntVar(
                    0, min_gap_val * min_gap_penalty_weight, f"min_gap_pen_neg_{i}_{j}"
                )
                scale = int(min_gap_penalty_weight * penalty_scale(task_i))
                model.Add(pen_pos == viol_pos * scale)
                model.Add(pen_neg == viol_neg * scale)

                loss_terms.append(pen_pos)
                loss_terms.append(pen_neg)

    optional_presences = [
        pres
        for task, _, _, _, pres in (tv.tuple for tv in task_vars)
        if not task.mandatory
    ]

    if optional_presences:
        opt_count = model.NewIntVar(0, len(optional_presences), "optional_task_count")
        model.Add(opt_count == sum(optional_presences))

        global_optional_bonus = model.NewIntVar(
            -5000 * len(optional_presences), 0, "global_optional_bonus"
        )
        model.Add(global_optional_bonus == -5000 * opt_count)
        loss_terms.append(global_optional_bonus)

    # Final objective
    if not loss_terms:
        # nothing to minimize; add a harmless 0 constant
        model.Minimize(model.NewConstant(0))
    else:
        model.Minimize(sum(loss_terms))
