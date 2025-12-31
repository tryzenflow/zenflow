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
    energy_weight=250,
    stability_weight=200,
    switch_penalty_weight=180,
    min_gap_penalty_weight=150,
):
    loss_terms = []

    # ----------------------------
    # Inclusion + per-split terms
    # ----------------------------
    for task, split, start, end, duration, presence in task_vars:
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

            mismatch = abs(task.energy - block.energy)

            if mismatch:
                pen = model.NewIntVar(0, task.duration * energy_weight, "")
                model.Add(pen == overlap * mismatch * energy_weight).OnlyEnforceIf(
                    presence
                )
                model.Add(pen == 0).OnlyEnforceIf(presence.Not())
                loss_terms.append(pen)
            else:
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

            both = model.NewBoolVar("")
            model.AddBoolAnd([p1, p2]).OnlyEnforceIf(both)
            model.AddBoolOr([p1.Not(), p2.Not()]).OnlyEnforceIf(both.Not())

            i_before_j = model.NewBoolVar("")
            model.Add(s2 >= e1).OnlyEnforceIf([i_before_j, both])
            model.Add(s1 >= e2).OnlyEnforceIf([i_before_j.Not(), both])

            immediate = model.NewBoolVar("")
            model.Add(immediate == 1).OnlyEnforceIf([i_before_j, both])
            model.Add(immediate == 0).OnlyEnforceIf([i_before_j.Not(), both])
            model.Add(immediate == 0).OnlyEnforceIf(both.Not())

            if t1.category != t2.category:
                pen = model.NewIntVar(0, switch_penalty_weight, "")
                model.Add(pen == switch_penalty_weight).OnlyEnforceIf(immediate)
                model.Add(pen == 0).OnlyEnforceIf(immediate.Not())
                loss_terms.append(pen)
            else:
                reward = model.NewIntVar(-switch_penalty_weight, 0, "")
                model.Add(reward == -switch_penalty_weight).OnlyEnforceIf(immediate)
                model.Add(reward == 0).OnlyEnforceIf(immediate.Not())
                loss_terms.append(reward)

    # ----------------------------
    # Soft min-gap penalty
    # ----------------------------
    if pref.min_gap_between_tasks > 0:
        for i in range(n):
            _, _, s1, e1, _, p1 = task_vars[i]
            for j in range(i + 1, n):
                _, _, s2, e2, _, p2 = task_vars[j]

                both = model.NewBoolVar("")
                model.AddBoolAnd([p1, p2]).OnlyEnforceIf(both)
                model.AddBoolOr([p1.Not(), p2.Not()]).OnlyEnforceIf(both.Not())

                gap = model.NewIntVar(-max_time, max_time, "")
                model.Add(gap == s2 - e1)

                viol = model.NewIntVar(0, pref.min_gap_between_tasks, "")
                model.Add(viol >= pref.min_gap_between_tasks - gap).OnlyEnforceIf(both)
                model.Add(viol == 0).OnlyEnforceIf(both.Not())

                pen = model.NewIntVar(
                    0,
                    pref.min_gap_between_tasks * min_gap_penalty_weight,
                    "",
                )
                model.Add(pen == viol * min_gap_penalty_weight)
                loss_terms.append(pen)

    # ----------------------------
    # Objective
    # ----------------------------
    model.Minimize(sum(loss_terms))
