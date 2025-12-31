from datetime import datetime, timedelta
from typing import List

from models import Constraints, FocusBlock, Interval, Schedule, Task
from scheduler import schedule_tasks


# Helper: merge focus blocks into available hours (union of blocks)
def get_available_hours_from_focus_blocks(
    focus_blocks: List[FocusBlock],
) -> List[Interval]:
    """
    Given a list of FocusBlock (with .interval.start and .interval.end),
    return a merged list of Interval objects representing the union of
    all focus-block time ranges (available hours).
    Overlapping and adjacent blocks are merged.
    """
    if not focus_blocks:
        return []

    # Extract start/end pairs, filter invalid where end <= start
    ranges = []
    for fb in focus_blocks:
        try:
            s = int(fb.interval.start)
            e = int(fb.interval.end)
        except Exception:
            continue
        if e > s:
            ranges.append((s, e))

    if not ranges:
        return []

    # Sort by start
    ranges.sort(key=lambda t: t[0])

    merged: List[Interval] = []
    cur_start, cur_end = ranges[0]
    for s, e in ranges[1:]:
        if s <= cur_end:  # overlap or adjacent
            cur_end = max(cur_end, e)
        else:
            merged.append(Interval(cur_start, cur_end))
            cur_start, cur_end = s, e
    merged.append(Interval(cur_start, cur_end))
    return merged


# Helper formatting
def minutes_to_hhmm(m: int) -> str:
    h = (m // 60) % 24
    mm = m % 60
    return f"{h:02d}:{mm:02d}"


def print_schedule(schedule):
    if not schedule:
        print("  <no tasks scheduled>")
        return
    for task, split, interval in sorted(
        schedule, key=lambda x: (x[2].start, x[0].title)
    ):
        print(
            f"  - {task.title[:30]:30} id={task.id[:6]} split={split:02d} "
            f"{minutes_to_hhmm(interval.start)}-{minutes_to_hhmm(interval.end)} "
            f"dur={interval.end - interval.start:3d}min mandatory={task.mandatory} pr={task.priority} cat={task.category} focus={task.focus}"
        )


def overlap_minutes(a_start, a_end, b_start, b_end):
    return max(0, min(a_end, b_end) - max(a_start, b_start))


# Diagnostics computed from schedule returned by schedule_tasks
def compute_available_outside(schedule, constraints):
    total_outside = 0
    for task, split, interval in schedule:
        dur = interval.end - interval.start
        inside = 0
        for block in constraints.available_hours:
            inside += overlap_minutes(
                interval.start, interval.end, block.start, block.end
            )
        outside = dur - inside
        total_outside += outside
    return total_outside


def compute_overload_minutes(schedule, max_focus_level, constraints, daily_load=0):
    total_eff = sum(
        (interval.end - interval.start)
        for (task, split, interval) in schedule
        if task.focus == max_focus_level
    )
    allowed = max(0, constraints.max_daily_load - daily_load)
    return max(0, total_eff - allowed)


def compute_batching_score(schedule):
    ordered = sorted(schedule, key=lambda x: x[2].start)
    score = 0
    switches = 0
    batches = 0
    for i in range(len(ordered) - 1):
        t1, s1, i1 = ordered[i]
        t2, s2, i2 = ordered[i + 1]
        if i2.start == i1.end:
            if t1.category == t2.category:
                score += 1
                batches += 1
            else:
                score -= 1
                switches += 1
    return {"score": score, "batches": batches, "switches": switches}


def compute_min_gap_violations(schedule, min_gap):
    ordered = sorted(schedule, key=lambda x: x[2].start)
    viol_count = 0
    viol_total_minutes = 0
    for i in range(len(ordered) - 1):
        _, _, cur_i = ordered[i]
        _, _, next_i = ordered[i + 1]
        gap = next_i.start - cur_i.end
        if gap < min_gap:
            viol_count += 1
            viol_total_minutes += min_gap - gap
    return {"violations": viol_count, "penalty_minutes": viol_total_minutes}


def compute_stability_deviation(schedule):
    dev = 0
    for task, split, interval in schedule:
        for ref in task.schedules:
            if ref.split == split:
                dev += abs(interval.start - ref.start) + abs(interval.end - ref.end)
                break
    return dev


def count_optional_scheduled(schedule):
    return sum(1 for task, split, interval in schedule if not task.mandatory)


# Energy alignment diagnostics: compute minutes overlapped with focus blocks and weighted mismatch
def compute_energy_alignment(schedule, constraints):
    total_aligned = 0
    total_mismatched = 0
    weighted_mismatch = 0
    per_task = []
    for task, split, interval in schedule:
        task_aligned = 0
        task_mismatch = 0
        weighted = 0
        for block in constraints.focus_blocks:
            ov = overlap_minutes(
                interval.start, interval.end, block.interval.start, block.interval.end
            )
            if ov <= 0:
                continue
            if block.level == task.focus:
                task_aligned += ov
            else:
                mm = abs(task.focus - block.level)
                task_mismatch += ov
                weighted += ov * mm
        total_aligned += task_aligned
        total_mismatched += task_mismatch
        weighted_mismatch += weighted
        per_task.append((task.title, task.focus, task_aligned, task_mismatch, weighted))
    return {
        "total_aligned_minutes": total_aligned,
        "total_mismatched_minutes": total_mismatched,
        "weighted_mismatch": weighted_mismatch,
        "per_task": per_task,
    }


# --- Existing scenarios (modified to compute avail from focus_blocks) ---
def case_available_hours_focus_on_in_hours():
    print("CASE: available_hours preference (many tasks)")
    focus_blocks = [
        FocusBlock(3, Interval(9 * 60, 11 * 60)),
        FocusBlock(1, Interval(13 * 60, 15 * 60)),
    ]
    # derive available hours (union) from focus blocks
    avail = get_available_hours_from_focus_blocks(focus_blocks)
    constraints = Constraints(
        available_hours=avail,
        min_gap_between_tasks=10,
        focus_blocks=focus_blocks,
        batch_similar_tasks=True,
        max_daily_load=240,
    )

    tasks = []
    tasks.append(
        Task("Team sync", 30, priority=2, mandatory=True, category="meetings", focus=1)
    )
    tasks.append(
        Task(
            "Deep analysis A", 120, priority=1, mandatory=True, category="deep", focus=3
        )
    )
    tasks.append(
        Task(
            "Deep analysis B", 90, priority=1, mandatory=True, category="deep", focus=3
        )
    )
    tasks.append(
        Task(
            "Feature design", 60, priority=2, mandatory=True, category="design", focus=2
        )
    )
    for i in range(6):
        tasks.append(
            Task(
                f"Optional admin {i + 1}",
                25,
                priority=3,
                mandatory=False,
                category="admin",
                focus=1,
            )
        )

    schedule = schedule_tasks(
        tasks, constraints, min_time=8 * 60, max_time=18 * 60, daily_load=0
    )
    print_schedule(schedule)
    outside = compute_available_outside(schedule, constraints)
    opt_scheduled = count_optional_scheduled(schedule)
    print(f"  -> Minutes outside available hours: {outside}")
    print(
        f"  -> Optional tasks scheduled: {opt_scheduled}/{len([t for t in tasks if not t.mandatory])}"
    )
    print()


def case_overload_and_focus_blocks():
    print("CASE: overload avoidance & energy/focus penalties")
    focus_blocks = [
        FocusBlock(3, Interval(9 * 60, 11 * 60)),  # deep work
        FocusBlock(2, Interval(14 * 60, 16 * 60)),  # medium
    ]
    avail = get_available_hours_from_focus_blocks(focus_blocks)
    constraints = Constraints(
        available_hours=avail,
        min_gap_between_tasks=5,
        focus_blocks=focus_blocks,
        batch_similar_tasks=False,
        max_daily_load=180,
    )

    tasks = []
    # Mandatory high-focus tasks (must be scheduled)
    for i in range(4):
        tasks.append(
            Task(
                f"Deep task M#{i + 1}",
                60,
                priority=1,
                mandatory=True,
                category="deep",
                focus=3,
            )
        )
    # Optional high-focus tasks (solver may drop these to avoid overload)
    for i in range(3):
        tasks.append(
            Task(
                f"Deep task OPT#{i + 1}",
                60,
                priority=2,
                mandatory=False,
                category="deep",
                focus=3,
            )
        )

    # Medium-focus tasks
    for i in range(3):
        tasks.append(
            Task(
                f"Medium task #{i + 1}",
                45,
                priority=2,
                mandatory=False,
                category="work",
                focus=2,
            )
        )
    # Low-focus optional admin tasks
    for i in range(4):
        tasks.append(
            Task(
                f"Admin {i + 1}",
                20,
                priority=3,
                mandatory=False,
                category="admin",
                focus=1,
            )
        )

    schedule = schedule_tasks(
        tasks,
        constraints,
        min_time=7 * 60,
        max_time=20 * 60,
        daily_load=0,
        max_focus_level=3,
    )
    print_schedule(schedule)

    # Diagnostics
    total_eff_minutes = sum(
        (interval.end - interval.start)
        for (task, split, interval) in schedule
        if task.focus == 3
    )
    allowed = max(0, constraints.max_daily_load - 0)
    overload_mins = max(0, total_eff_minutes - allowed)

    outside = compute_available_outside(schedule, constraints)
    total_optional = len([t for t in tasks if not t.mandatory])
    optional_scheduled = count_optional_scheduled(schedule)
    optional_deep_total = len([t for t in tasks if (not t.mandatory and t.focus == 3)])
    optional_deep_scheduled = sum(
        1
        for (task, split, interval) in schedule
        if (not task.mandatory and task.focus == 3)
    )

    print(f"  -> Total effective focus==3 minutes scheduled: {total_eff_minutes}")
    print(f"  -> Allowed (max_daily_load): {allowed}")
    print(f"  -> Overload minutes (focus==3 beyond allowed): {overload_mins}")
    print(f"  -> Minutes outside available hours: {outside}")
    print(f"  -> Optional tasks scheduled: {optional_scheduled}/{total_optional}")
    print(
        f"  -> Optional deep tasks scheduled: {optional_deep_scheduled}/{optional_deep_total}"
    )
    print()


def case_batching_and_min_gap_many_short():
    print("CASE: batching reward vs swapping & min-gap penalties")
    focus_blocks = [FocusBlock(1, Interval(8 * 60, 18 * 60))]
    avail = get_available_hours_from_focus_blocks(focus_blocks)
    constraints = Constraints(
        available_hours=avail,
        min_gap_between_tasks=20,
        focus_blocks=focus_blocks,
        batch_similar_tasks=True,
        max_daily_load=240,
    )

    tasks = []
    for i in range(6):
        tasks.append(
            Task(
                f"Call with client {i + 1}",
                15,
                priority=1 if i % 2 == 0 else 2,
                mandatory=False,
                category="calls",
                focus=1,
            )
        )
    for i in range(6):
        tasks.append(
            Task(
                f"Admin item {i + 1}",
                20,
                priority=3,
                mandatory=False,
                category="admin",
                focus=1,
            )
        )
    tasks.append(
        Task(
            "Daily planning",
            30,
            priority=1,
            mandatory=True,
            category="planning",
            focus=1,
        )
    )
    tasks.append(
        Task(
            "Urgent sync", 30, priority=1, mandatory=True, category="meetings", focus=1
        )
    )

    schedule = schedule_tasks(
        tasks, constraints, min_time=8 * 60, max_time=18 * 60, daily_load=0
    )
    print_schedule(schedule)
    batching = compute_batching_score(schedule)
    min_gap = compute_min_gap_violations(schedule, constraints.min_gap_between_tasks)
    print(f"  -> Batching score: {batching}")
    print(f"  -> Min-gap violations: {min_gap}")
    print()


def case_deadlines_prereq_stability():
    print("CASE: deadlines, prerequisites & stability preference")
    focus_blocks = [FocusBlock(2, Interval(10 * 60, 14 * 60))]
    avail = get_available_hours_from_focus_blocks(focus_blocks)
    constraints = Constraints(
        available_hours=avail,
        min_gap_between_tasks=5,
        focus_blocks=focus_blocks,
        batch_similar_tasks=False,
        max_daily_load=300,
    )

    tasks = []
    tA = Task(
        "Draft proposal", 90, priority=1, mandatory=True, category="writing", focus=2
    )
    tB = Task(
        "Review proposal",
        60,
        priority=1,
        mandatory=True,
        category="writing",
        prerequisites=[tA.id],
        focus=2,
    )
    tC = Task(
        "Polish & send",
        30,
        priority=1,
        mandatory=True,
        category="writing",
        prerequisites=[tB.id],
        focus=1,
    )
    tasks.extend([tA, tB, tC])

    now = datetime.now()
    tasks.append(
        Task(
            "Support hotspot",
            30,
            priority=1,
            mandatory=False,
            deadline=now + timedelta(hours=2),
            category="support",
            focus=1,
        )
    )
    tasks.append(
        Task(
            "Customer bug",
            45,
            priority=1,
            mandatory=False,
            deadline=now + timedelta(hours=6),
            category="support",
            focus=1,
        )
    )
    tasks.append(
        Task(
            "Backlog cleanup",
            60,
            priority=3,
            mandatory=False,
            category="admin",
            focus=1,
        )
    )

    ref = Schedule(start=11 * 60, end=12 * 60, split=0)
    stable_task = Task(
        "Planned interview",
        60,
        priority=2,
        mandatory=False,
        schedules=[ref],
        category="calls",
        focus=1,
    )
    tasks.append(stable_task)

    schedule = schedule_tasks(
        tasks, constraints, min_time=8 * 60, max_time=20 * 60, daily_load=0
    )
    print_schedule(schedule)
    dev = compute_stability_deviation(schedule)
    outside = compute_available_outside(schedule, constraints)
    opt_scheduled = count_optional_scheduled(schedule)
    print(f"  -> Stability deviation (sum abs minutes from refs): {dev}")
    print(f"  -> Minutes outside available hours: {outside}")
    print(
        f"  -> Optional tasks scheduled: {opt_scheduled}/{len([t for t in tasks if not t.mandatory])}"
    )
    print()


# --- New scenario: Energy alignment focus (also uses merged available hours) ---
def case_energy_alignment():
    print("CASE: energy alignment (focus block matching)")
    focus_blocks = [
        FocusBlock(3, Interval(8 * 60, 10 * 60)),  # 08:00-10:00 high focus
        FocusBlock(1, Interval(10 * 60, 13 * 60)),  # 10:00-13:00 low focus
        FocusBlock(2, Interval(13 * 60, 16 * 60)),  # 13:00-16:00 medium focus
    ]
    avail = get_available_hours_from_focus_blocks(focus_blocks)
    constraints = Constraints(
        available_hours=avail,
        min_gap_between_tasks=5,
        focus_blocks=focus_blocks,
        batch_similar_tasks=True,
        max_daily_load=300,
    )

    tasks = []
    for i in range(4):
        tasks.append(
            Task(
                f"Deep focus task #{i + 1}",
                45,
                priority=1,
                mandatory=True,
                category="deep",
                focus=3,
            )
        )
    for i in range(3):
        tasks.append(
            Task(
                f"Design task #{i + 1}",
                60,
                priority=2,
                mandatory=True,
                category="design",
                focus=2,
            )
        )
    for i in range(5):
        tasks.append(
            Task(
                f"Admin task #{i + 1}",
                25,
                priority=3,
                mandatory=False,
                category="admin",
                focus=1,
            )
        )
    tasks.append(
        Task(
            "Optional deep overflow",
            90,
            priority=2,
            mandatory=False,
            category="deep",
            focus=3,
        )
    )

    schedule = schedule_tasks(
        tasks,
        constraints,
        min_time=8 * 60,
        max_time=17 * 60,
        daily_load=0,
        max_focus_level=3,
    )
    print_schedule(schedule)
    alignment = compute_energy_alignment(schedule, constraints)
    outside = compute_available_outside(schedule, constraints)
    print(
        f"  -> Total aligned minutes (task overlap with same-level blocks): {alignment['total_aligned_minutes']}"
    )
    print(
        f"  -> Total mismatched minutes (task overlap with differing blocks): {alignment['total_mismatched_minutes']}"
    )
    print(
        f"  -> Weighted mismatch (sum mismatch*minutes): {alignment['weighted_mismatch']}"
    )
    print(f"  -> Minutes outside available hours: {outside}")
    print(
        "  -> Per-task breakdown (title, focus, aligned_min, mismatched_min, weighted_mismatch):"
    )
    for row in alignment["per_task"]:
        print(
            f"      - {row[0]:25} focus={row[1]}  aligned={row[2]:3d}  mismatched={row[3]:3d}  weighted_mismatch={row[4]:3d}"
        )
    print()


def case_optional_tasks_encouraged():
    print("CASE: optional tasks are encouraged (regression diagnostic)")

    focus_blocks = [
        FocusBlock(3, Interval(9 * 60, 11 * 60)),
        FocusBlock(1, Interval(13 * 60, 15 * 60)),
    ]
    avail = get_available_hours_from_focus_blocks(focus_blocks)

    constraints = Constraints(
        available_hours=avail,
        min_gap_between_tasks=10,
        focus_blocks=focus_blocks,
        batch_similar_tasks=True,
        max_daily_load=240,
    )

    tasks = []
    tasks.append(
        Task(
            "Mandatory deep work",
            120,
            priority=1,
            mandatory=True,
            category="deep",
            focus=3,
        )
    )
    tasks.append(
        Task(
            "Mandatory meeting",
            60,
            priority=2,
            mandatory=True,
            category="meetings",
            focus=1,
        )
    )

    for i in range(8):
        tasks.append(
            Task(
                f"Optional admin #{i + 1}",
                25,
                priority=3,
                mandatory=False,
                category="admin",
                focus=1,
            )
        )

    schedule = schedule_tasks(
        tasks,
        constraints,
        min_time=8 * 60,
        max_time=18 * 60,
        daily_load=0,
        max_focus_level=3,
    )

    print_schedule(schedule)

    # Diagnostics (same style as other cases)
    outside = compute_available_outside(schedule, constraints)
    opt_scheduled = count_optional_scheduled(schedule)
    total_optional = len([t for t in tasks if not t.mandatory])

    batching = compute_batching_score(schedule)
    min_gap = compute_min_gap_violations(schedule, constraints.min_gap_between_tasks)

    print(f"  -> Optional tasks scheduled: {opt_scheduled}/{total_optional}")
    print(f"  -> Minutes outside available hours: {outside}")
    print(f"  -> Batching score: {batching}")
    print(f"  -> Min-gap violations: {min_gap}")
    print()


# Run all scenarios including energy alignment
def run_all():
    case_available_hours_focus_on_in_hours()
    case_overload_and_focus_blocks()
    case_batching_and_min_gap_many_short()
    case_deadlines_prereq_stability()
    case_energy_alignment()
    case_optional_tasks_encouraged()


if __name__ == "__main__":
    run_all()
