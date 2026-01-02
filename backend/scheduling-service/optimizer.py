from collections import defaultdict

from models import UserPreference
from ortools.sat.python import cp_model


def optimize_function(
    model: cp_model.CpModel,
    task_vars,
    pref: UserPreference,
    max_time=24 * 60,
    # weights
    priority_weight=300,
    deadline_weight=400,
    pref_overlap_weight=5000,
    pref_inside_weight=100000,
    energy_weight=250,
    stability_weight=200,
    switch_penalty_weight=180,
    min_gap_penalty_weight=600,
    split_weight=400,  # penalty per extra split
    span_weight=120,
    small_block_weight=900,  # penalty for tiny fragments
    min_good_block=45,  # minutes
):
    loss_terms = []
    splits_by_task = defaultdict(list)

    # ----------------------------
    # Inclusion + per-split terms
    # ----------------------------
    for task, split, start, end, duration, presence in task_vars:
        splits_by_task[task].append((split, start, end, duration, presence))
        # ------------------------
        # Penalize small splits
        # ------------------------
        small = model.NewBoolVar(f"small_block_{task.id}_{split}")

        # small == 1 if presence AND duration < MIN_GOOD_BLOCK
        model.Add(duration < min_good_block).OnlyEnforceIf(small)
        model.Add(duration >= min_good_block).OnlyEnforceIf(small.Not())
        model.Add(small == 0).OnlyEnforceIf(presence.Not())

        small_pen = model.NewIntVar(0, small_block_weight, "")
        model.Add(small_pen == small_block_weight).OnlyEnforceIf(small)
        model.Add(small_pen == 0).OnlyEnforceIf(small.Not())

        loss_terms.append(small_pen)

        # ------------------------
        # Inclusion reward
        # ------------------------
        importance = (
            priority_weight * (3 - task.priority)
            + energy_weight * task.energy
            + deadline_weight * task.deadline_weight
        )
        inclusion_bonus = model.NewIntVar(
            -importance * task.duration, 0, f"inclusion_{task.id}_{split}"
        )
        model.Add(inclusion_bonus == -importance * duration).OnlyEnforceIf(presence)
        model.Add(inclusion_bonus == 0).OnlyEnforceIf(presence.Not())
        loss_terms.append(inclusion_bonus)

        for i, pref_window in enumerate(task.preferred_windows):
            # Compute overlap between [start, end] and preferred window
            latest_start = model.NewIntVar(0, max_time, "")
            earliest_end = model.NewIntVar(0, max_time, "")
            overlap = model.NewIntVar(0, task.duration, "")

            model.AddMaxEquality(latest_start, [start, pref_window.start])
            model.AddMinEquality(earliest_end, [end, pref_window.end])

            diff = model.NewIntVar(-max_time, max_time, "")
            model.Add(diff == earliest_end - latest_start)
            model.AddMaxEquality(overlap, [diff, model.NewConstant(0)])

            # Penalize time OUTSIDE preferred window
            outside = model.NewIntVar(0, task.duration, "")
            model.Add(outside == duration - overlap)

            outside_penalty = model.NewIntVar(
                0, task.duration * pref_overlap_weight, ""
            )
            model.Add(outside_penalty == outside * pref_overlap_weight).OnlyEnforceIf(
                presence
            )
            model.Add(outside_penalty == 0).OnlyEnforceIf(presence.Not())

            # Strong "must be fully inside" soft constraint
            is_inside = model.NewBoolVar(f"inside_pref_{task.id}_{i}")

            model.Add(overlap >= duration).OnlyEnforceIf([is_inside, presence])
            model.Add(overlap < duration).OnlyEnforceIf(is_inside.Not())

            miss_pen = model.NewIntVar(0, pref_inside_weight, "")
            model.Add(miss_pen == pref_inside_weight).OnlyEnforceIf(
                [presence, is_inside.Not()]
            )
            model.Add(miss_pen == 0).OnlyEnforceIf(presence.Not())

            loss_terms.append(outside_penalty)
            loss_terms.append(miss_pen)

        # ------------------------
        # Stability (reference schedule)
        # ------------------------
        if split < len(task.scheduled_blocks):
            ref = task.scheduled_blocks[split]

            ds = model.NewIntVar(0, max_time, "")
            de = model.NewIntVar(0, max_time, "")

            diff_s = model.NewIntVar(-max_time, max_time, "")
            diff_e = model.NewIntVar(-max_time, max_time, "")

            model.Add(diff_s == start - ref.start)
            model.Add(diff_e == end - ref.end)
            model.AddAbsEquality(ds, diff_s)
            model.AddAbsEquality(de, diff_e)

            stab_pen = model.NewIntVar(0, 2 * max_time * stability_weight, "")
            model.Add(stab_pen == stability_weight * (ds + de)).OnlyEnforceIf(presence)
            model.Add(stab_pen == 0).OnlyEnforceIf(presence.Not())
            loss_terms.append(stab_pen)

        # ------------------------
        # Energy alignment
        # ------------------------
        for block in pref.energy_blocks:
            latest_start = model.NewIntVar(0, max_time, "")
            earliest_end = model.NewIntVar(0, max_time, "")
            overlap = model.NewIntVar(0, task.duration, "")

            model.AddMaxEquality(latest_start, [start, block.start])
            model.AddMinEquality(earliest_end, [end, block.end])

            diff = model.NewIntVar(-max_time, max_time, "")
            model.Add(diff == earliest_end - latest_start)
            model.AddMaxEquality(overlap, [diff, model.NewConstant(0)])

            if task.energy == block.energy:
                bonus = model.NewIntVar(-task.duration * energy_weight, 0, "")
                model.Add(bonus == -overlap * energy_weight).OnlyEnforceIf(presence)
                model.Add(bonus == 0).OnlyEnforceIf(presence.Not())
                loss_terms.append(bonus)

    # ----------------------------
    # Context switching penalty
    # ----------------------------

    n = len(task_vars)

    for i in range(n):
        t1, _, s1, e1, _, p1 = task_vars[i]

        for j in range(i + 1, n):
            t2, _, s2, e2, _, p2 = task_vars[j]

            both = model.NewBoolVar(f"both_{i}_{j}")
            model.AddBoolAnd([p1, p2]).OnlyEnforceIf(both)
            model.AddBoolOr([p1.Not(), p2.Not()]).OnlyEnforceIf(both.Not())

            # ------------------------
            # Ordering
            # ------------------------
            i_before_j = model.NewBoolVar(f"i_before_j_{i}_{j}")
            j_before_i = model.NewBoolVar(f"j_before_i_{i}_{j}")

            model.Add(s2 >= e1).OnlyEnforceIf(i_before_j)
            model.Add(s1 >= e2).OnlyEnforceIf(j_before_i)
            model.AddBoolOr([i_before_j, j_before_i])

            # ------------------------
            # Gap
            # ------------------------
            gap = model.NewIntVar(0, max_time, f"gap_{i}_{j}")

            model.Add(gap == s2 - e1).OnlyEnforceIf(i_before_j)
            model.Add(gap == s1 - e2).OnlyEnforceIf(j_before_i)

            # ------------------------
            # Adjacent (soft)
            # ------------------------
            adjacent = model.NewBoolVar(f"adj_{i}_{j}")
            model.Add(gap <= pref.min_gap_between_tasks).OnlyEnforceIf(adjacent)
            model.Add(gap > pref.min_gap_between_tasks).OnlyEnforceIf(adjacent.Not())
            model.Add(adjacent == 0).OnlyEnforceIf(both.Not())

            # ------------------------
            # Context switch reward / penalty
            # ------------------------
            if t1.category == t2.category:
                reward = model.NewIntVar(-switch_penalty_weight, 0, "")
                model.Add(reward == -switch_penalty_weight).OnlyEnforceIf(adjacent)
                model.Add(reward == 0).OnlyEnforceIf(adjacent.Not())
                loss_terms.append(reward)
            else:
                pen = model.NewIntVar(0, switch_penalty_weight, "")
                model.Add(pen == switch_penalty_weight).OnlyEnforceIf(adjacent)
                model.Add(pen == 0).OnlyEnforceIf(adjacent.Not())
                loss_terms.append(pen)

            # ------------------------
            # Soft min-gap violation
            # ------------------------
            viol = model.NewIntVar(0, pref.min_gap_between_tasks, "")
            model.Add(viol >= pref.min_gap_between_tasks - gap)
            model.Add(viol >= 0)

            gap_pen = model.NewIntVar(
                0, pref.min_gap_between_tasks * min_gap_penalty_weight, ""
            )
            model.Add(gap_pen == viol * min_gap_penalty_weight)
            loss_terms.append(gap_pen)

    for task, splits in splits_by_task.items():
        presences = [p for _, _, _, _, p in splits]

        used_splits = model.NewIntVar(0, task.max_splits, f"used_splits_{task.id}")
        model.Add(used_splits == sum(presences))

        # first split is "free"
        extra_splits = model.NewIntVar(0, task.max_splits, f"extra_splits_{task.id}")
        model.Add(extra_splits == used_splits - 1)

        split_penalty = model.NewIntVar(
            0, task.max_splits * split_weight, f"split_pen_{task.id}"
        )
        model.Add(split_penalty == extra_splits * split_weight)
        starts = []
        ends = []

        for _, start, end, _, presence in splits:
            s = model.NewIntVar(0, max_time, "")
            e = model.NewIntVar(0, max_time, "")

            model.Add(s == start).OnlyEnforceIf(presence)
            model.Add(s == max_time).OnlyEnforceIf(presence.Not())

            model.Add(e == end).OnlyEnforceIf(presence)
            model.Add(e == 0).OnlyEnforceIf(presence.Not())

            starts.append(s)
            ends.append(e)

        # ----------------------------
        # Task span penalty (discourage scattering)
        # ----------------------------
        earliest = model.NewIntVar(0, max_time, f"task_earliest_{task.id}")
        latest = model.NewIntVar(0, max_time, f"task_latest_{task.id}")

        model.AddMinEquality(earliest, starts)
        model.AddMaxEquality(latest, ends)

        span = model.NewIntVar(0, max_time, f"task_span_{task.id}")
        model.Add(span == latest - earliest)

        span_pen = model.NewIntVar(0, max_time * span_weight, "")
        model.Add(span_pen == span * span_weight)

        loss_terms.append(span_pen)

    # ----------------------------
    # Objective
    # ----------------------------
    model.Minimize(sum(loss_terms))
