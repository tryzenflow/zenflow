from datetime import datetime, timedelta

from models import (
    EnergyBlock,
    Interval,
    ScheduledBlock,
    Task,
    UserPreference,
)
from scheduler import schedule_tasks

# -------------------------
# Helpers
# -------------------------


def minutes_to_hhmm(m: int) -> str:
    return f"{m // 60:02d}:{m % 60:02d}"


def total_scheduled_minutes(schedule):
    return sum(interval.end - interval.start for _, _, interval in schedule)


def count_splits(schedule):
    by_task = {}
    for task, split, _ in schedule:
        by_task.setdefault(task.id, set()).add(split)
    return {tid: len(splits) for tid, splits in by_task.items()}


def context_switch_metrics(schedule):
    ordered = sorted(schedule, key=lambda x: x[2].start)
    switches = 0
    batches = 0
    for i in range(len(ordered) - 1):
        t1, _, i1 = ordered[i]
        t2, _, i2 = ordered[i + 1]
        if i2.start == i1.end:
            if t1.category == t2.category:
                batches += 1
            else:
                switches += 1
    return {"switches": switches, "batches": batches}


def energy_metrics(schedule, pref):
    aligned = 0
    mismatched = 0
    weighted_mismatch = 0

    for task, _, interval in schedule:
        for block in pref.energy_blocks:
            ov = overlap(interval, Interval(block.start, block.end))
            if ov <= 0:
                continue
            if block.energy == task.energy:
                aligned += ov
            else:
                mismatched += ov
                weighted_mismatch += ov * abs(block.energy - task.energy)

    return {
        "aligned": aligned,
        "mismatched": mismatched,
        "weighted_mismatch": weighted_mismatch,
    }


def task_completion_metrics(tasks, schedule):
    scheduled_by_task = {}
    for task, _, interval in schedule:
        scheduled_by_task.setdefault(task.id, 0)
        scheduled_by_task[task.id] += interval.end - interval.start

    completed = []
    partial = []
    dropped = []

    for task in tasks:
        scheduled = scheduled_by_task.get(task.id, 0)
        if scheduled == 0:
            dropped.append(task.title)
        elif scheduled < task.duration:
            partial.append((task.title, task.duration - scheduled, task.duration))
        else:
            completed.append(task.title)

    return {
        "completed": completed,
        "partial": partial,
        "dropped": dropped,
    }


def print_schedule(schedule):
    if not schedule:
        print("  <no tasks scheduled>")
        return
    for task, split, interval in sorted(schedule, key=lambda x: x[2].start):
        print(
            f"  - {task.title:25} "
            f"{minutes_to_hhmm(interval.start)}–{minutes_to_hhmm(interval.end)} "
            f"dur={interval.end - interval.start:3d} "
            f"pr={task.priority} energy={task.energy} cat={task.category}"
        )


def overlap(a: Interval, b: Interval) -> int:
    return max(0, min(a.end, b.end) - max(a.start, b.start))


# -------------------------
# HARD CONSTRAINT TESTS
# -------------------------


def case_hard_available_hours_only():
    print("\nCASE: HARD available_hours")

    pref = UserPreference(
        available_hours=[
            Interval(9 * 60, 12 * 60),
            Interval(13 * 60, 17 * 60),
        ]
    )

    tasks = [
        Task("Task A", 60),
        Task("Task B", 90),
        Task("Task C", 120),
    ]

    schedule = schedule_tasks(tasks, pref, min_time=8 * 60, max_time=18 * 60)
    print_schedule(schedule)

    for _, _, interval in schedule:
        assert any(
            interval.start >= b.start and interval.end <= b.end
            for b in pref.available_hours
        ), "❌ Task scheduled outside available_hours"


def case_task_splitting_behavior():
    print("\nCASE: task splitting behavior")

    pref = UserPreference(
        available_hours=[
            Interval(9 * 60, 10 * 60),  # 60 min
            Interval(11 * 60, 12 * 60),  # 60 min
            Interval(14 * 60, 15 * 60),  # 60 min
        ]
    )

    long_task = Task(
        "Long task",
        duration=150,  # needs splits
        priority=1,
        energy=2,
    )

    schedule = schedule_tasks([long_task], pref)
    print_schedule(schedule)

    splits = count_splits(schedule)
    total = total_scheduled_minutes(schedule)

    print(f"  -> total scheduled minutes: {total}")
    print(f"  -> splits used: {splits}")

    assert total <= long_task.duration
    assert splits[long_task.id] <= long_task.max_splits


# -------------------------
# SOFT CONSTRAINTS (ISOLATED)
# -------------------------


def case_energy_alignment_only():
    print("\nCASE: energy alignment metrics")

    pref = UserPreference(
        available_hours=[Interval(8 * 60, 18 * 60)],
        energy_blocks=[
            EnergyBlock(8 * 60, 10 * 60, energy=3),
            EnergyBlock(10 * 60, 13 * 60, energy=1),
            EnergyBlock(13 * 60, 16 * 60, energy=2),
        ],
    )

    tasks = [
        Task("Deep A", 90, energy=3, priority=1),
        Task("Admin A", 60, energy=1, priority=3),
        Task("Design A", 60, energy=2, priority=2),
    ]

    schedule = schedule_tasks(tasks, pref)
    print_schedule(schedule)

    m = energy_metrics(schedule, pref)
    print(f"  -> aligned minutes: {m['aligned']}")
    print(f"  -> mismatched minutes: {m['mismatched']}")
    print(f"  -> weighted mismatch: {m['weighted_mismatch']}")

    assert m["aligned"] >= m["mismatched"]


def case_min_gap_only():
    print("\nCASE: SOFT min_gap_between_tasks")

    pref = UserPreference(
        available_hours=[Interval(9 * 60, 12 * 60)],
        min_gap_between_tasks=20,
    )

    tasks = [
        Task("Short 1", 15),
        Task("Short 2", 15),
        Task("Short 3", 15),
    ]

    schedule = schedule_tasks(tasks, pref)
    print_schedule(schedule)

    ordered = sorted(schedule, key=lambda x: x[2].start)
    for i in range(len(ordered) - 1):
        gap = ordered[i + 1][2].start - ordered[i][2].end
        print(f"    gap = {gap} min")


def case_context_switch_only():
    print("\nCASE: context switching with many tasks")

    pref = UserPreference(
        available_hours=[Interval(9 * 60, 17 * 60)],
    )

    tasks = []

    # Calls
    for i in range(5):
        tasks.append(Task(f"Call {i + 1}", 15, category="calls", priority=1))

    # Admin
    for i in range(5):
        tasks.append(Task(f"Admin {i + 1}", 15, category="admin", priority=3))

    # Writing
    for i in range(5):
        tasks.append(Task(f"Writing {i + 1}", 30, category="writing", priority=2))

    schedule = schedule_tasks(tasks, pref)
    print_schedule(schedule)

    metrics = context_switch_metrics(schedule)
    print(f"  -> context switches: {metrics['switches']}")
    print(f"  -> same-category batches: {metrics['batches']}")

    assert metrics["batches"] >= metrics["switches"]


def case_stability_only():
    print("\nCASE: SOFT stability preference")

    pref = UserPreference(
        available_hours=[Interval(9 * 60, 17 * 60)],
    )

    task = Task("Stable task", 60, priority=2)
    task.scheduled_blocks = [ScheduledBlock(start=10 * 60, end=11 * 60, split_index=0)]

    schedule = schedule_tasks([task], pref)
    print_schedule(schedule)

    for _, _, interval in schedule:
        dev = abs(interval.start - 10 * 60)
        print(f"    deviation from reference: {dev} min")


def case_priority_deadline_inclusion():
    print("\nCASE: priority & deadline metrics")

    now = datetime.now()

    pref = UserPreference(
        available_hours=[Interval(9 * 60, 12 * 60)],
    )

    tasks = [
        Task("Low priority", 60, priority=3),
        Task(
            "Urgent",
            60,
            priority=1,
            deadline=now + timedelta(minutes=90),
        ),
        Task("Medium", 60, priority=2),
    ]

    schedule = schedule_tasks(tasks, pref)
    print_schedule(schedule)

    titles = [t.title for t, _, _ in schedule]
    print(f"  -> scheduled titles: {titles}")

    # assert "Urgent" in titles


def case_partial_task_due_to_time_limit():
    print("\nCASE: partial task due to limited time")

    pref = UserPreference(
        available_hours=[Interval(9 * 60, 11 * 60)]  # 120 min
    )

    tasks = [
        Task("Critical long task", 180, priority=1),  # needs 3h
        Task("Small urgent", 30, priority=1),
    ]

    schedule = schedule_tasks(tasks, pref)
    print_schedule(schedule)

    m = task_completion_metrics(tasks, schedule)
    print("  -> completed:", m["completed"])
    print("  -> partial:", m["partial"])
    print("  -> dropped:", m["dropped"])

    assert "Critical long task" not in m["dropped"]
    assert any(t[0] == "Critical long task" for t in m["partial"])


def case_low_priority_dropped():
    print("\nCASE: low priority task dropped")

    pref = UserPreference(
        available_hours=[Interval(9 * 60, 10 * 60)]  # 45 min
    )

    tasks = [
        Task("High priority", 60, priority=1),
        Task("Low priority", 45, priority=3),
    ]

    schedule = schedule_tasks(tasks, pref)
    print_schedule(schedule)

    m = task_completion_metrics(tasks, schedule)
    print("  -> dropped:", m["dropped"])

    assert "Low priority" in m["dropped"]
    assert "High priority" not in m["dropped"]


# -------------------------
# Run all
# -------------------------


def run_all():
    case_hard_available_hours_only()
    case_energy_alignment_only()
    case_min_gap_only()
    case_task_splitting_behavior()
    case_context_switch_only()
    case_stability_only()
    case_priority_deadline_inclusion()
    case_partial_task_due_to_time_limit()
    case_low_priority_dropped()


if __name__ == "__main__":
    run_all()
