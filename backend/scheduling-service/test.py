from datetime import datetime, timedelta

from models import (
    EnergyBlock,
    Interval,
    ScheduledBlock,
    Task,
    UserPreference,
)
from scheduler import schedule_tasks
from utils import minutes_to_hhmm

# -------------------------
# Helpers
# -------------------------


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


def case_task_splitting_behavior():
    print("\nCASE: realistic mixed-duration task splitting")

    pref = UserPreference(
        energy_blocks=[
            EnergyBlock(9 * 60, 11 * 60, energy=3),  # peak focus
            EnergyBlock(11 * 60, 13 * 60, energy=2),  # steady
            EnergyBlock(14 * 60, 17 * 60, energy=2),  # afternoon
        ],
        min_gap_between_tasks=15,
    )

    tasks = [
        Task(
            "Write system design doc",
            duration=150,  # long deep work
            priority=1,
            energy=3,
        ),
        Task(
            "Design review notes",
            duration=120,  # medium focus
            priority=2,
            energy=2,
        ),
        Task(
            "Email inbox cleanup",
            duration=30,  # short admin
            priority=3,
            energy=1,
        ),
        Task(
            "Slack follow-ups",
            duration=15,  # very short admin
            priority=3,
            energy=1,
        ),
    ]

    schedule = schedule_tasks(tasks, pref)
    print_schedule(schedule)

    # ---- Analyze per-task behavior ----
    by_task = {}
    for task, _, block in schedule:
        by_task.setdefault(task.title, []).append(block)

    print("\nOBSERVATIONS")
    for title, blocks in by_task.items():
        durations = [b.end - b.start for b in blocks]
        total = sum(durations)

        print(f"\n  {title}")
        print(f"    → total planned: {total} min")
        print(f"    → sessions: {len(blocks)}")
        print(f"    → session lengths: {durations}")

        # Soft human expectations
        if total >= 120:
            assert len(blocks) >= 2, "Long task was not split"
            assert min(durations) >= 45, "Long task split into micro-blocks"

        if total <= 30:
            assert len(blocks) == 1, "Short task should not be split"

        if 45 <= total <= 75:
            assert len(blocks) <= 2, "Medium task oversplit"

    # ---- Global sanity checks ----
    all_blocks = [b for blocks in by_task.values() for b in blocks]
    all_durations = [b.end - b.start for b in all_blocks]

    assert min(all_durations) >= 15, "Unrealistically tiny block found"
    assert max(all_durations) <= 120, "Unrealistically long focus block found"


# -------------------------
# SOFT CONSTRAINTS (ISOLATED)
# -------------------------


def case_energy_alignment():
    print("\nCASE: realistic energy alignment behavior")

    # Simulated human energy curve for a workday
    pref = UserPreference(
        energy_blocks=[
            EnergyBlock(7 * 60, 9 * 60, energy=2),  # morning warm-up
            EnergyBlock(9 * 60, 12 * 60, energy=3),  # peak focus
            EnergyBlock(12 * 60, 14 * 60, energy=1),  # lunch slump
            EnergyBlock(14 * 60, 17 * 60, energy=2),  # steady work
        ]
    )

    tasks = [
        # High-focus task that should land in peak hours (may split)
        Task(
            "Deep architecture work",
            duration=150,  # forces split
            energy=3,
            priority=1,
        ),
        # Low-energy admin, should be pushed into slump
        Task(
            "Email & paperwork",
            duration=60,
            energy=1,
            priority=3,
        ),
        # Medium-energy creative task
        Task(
            "Product design",
            duration=90,
            energy=2,
            priority=2,
        ),
        # Slight mismatch task (energy=2 but competes with peak)
        Task(
            "Code review",
            duration=60,
            energy=2,
            priority=2,
        ),
        # Short filler task (can go anywhere)
        Task(
            "Inbox cleanup",
            duration=30,
            energy=1,
            priority=3,
        ),
    ]

    schedule = schedule_tasks(tasks, pref)
    print_schedule(schedule)

    # ---- Energy metrics ----
    m = energy_metrics(schedule, pref)
    print(f"  -> aligned minutes: {m['aligned']}")
    print(f"  -> mismatched minutes: {m['mismatched']}")
    print(f"  -> weighted mismatch: {m['weighted_mismatch']}")

    # ---- Sanity expectations ----
    assert m["aligned"] > 0, "No energy-aligned time found"
    assert m["aligned"] >= m["mismatched"], "Energy alignment worse than mismatch"


def case_min_gap_only():
    print("\nCASE: SOFT min_gap_between_tasks (micro-task fatigue)")

    pref = UserPreference(
        energy_blocks=[EnergyBlock(9 * 60, 17 * 60, 3)],
        min_gap_between_tasks=15,  # coffee / mental reset
    )

    tasks = [
        Task("Slack replies", 15, priority=3),
        Task("Expense receipt upload", 15, priority=3),
        Task("Quick status update", 15, priority=2),
        Task("Bug triage", 30, priority=1),
    ]

    schedule = schedule_tasks(tasks, pref)
    print_schedule(schedule)

    ordered = sorted(schedule, key=lambda x: x[2].start)
    for i in range(len(ordered) - 1):
        gap = ordered[i + 1][2].start - ordered[i][2].end
        print(f"    gap = {gap} min")


def case_context_switch_only():
    print("\nCASE: context switching in a real workday")

    pref = UserPreference(energy_blocks=[EnergyBlock(9 * 60, 17 * 60, 3)])

    tasks = [
        # Calls (urgent, should cluster)
        Task("Client call A", 30, category="calls", priority=1),
        Task("Client call B", 30, category="calls", priority=1),
        Task("Recruiter call", 15, category="calls", priority=2),
        # Writing (deep work)
        Task("Write proposal", 90, category="writing", priority=1),
        Task("Documentation update", 60, category="writing", priority=2),
        # Admin (low priority fillers)
        Task("Invoice review", 30, category="admin", priority=3),
        Task("CRM cleanup", 30, category="admin", priority=3),
    ]

    schedule = schedule_tasks(tasks, pref)
    print_schedule(schedule)

    metrics = context_switch_metrics(schedule)
    print(f"  -> context switches: {metrics['switches']}")
    print(f"  -> same-category batches: {metrics['batches']}")


def case_priority_deadline_inclusion():
    print("\nCASE: priority & deadline triage")

    now = datetime.now()

    pref = UserPreference(energy_blocks=[EnergyBlock(9 * 60, 12 * 60, 3)])

    tasks = [
        Task("Refactor later", 60, priority=3),
        Task(
            "Production incident",
            60,
            priority=1,
            deadline=now + timedelta(minutes=90),
        ),
        Task("Prepare slides", 60, priority=2),
        Task("Nice-to-have cleanup", 30, priority=3),
    ]

    schedule = schedule_tasks(tasks, pref)
    print_schedule(schedule)

    titles = [t.title for t, _, _ in schedule]
    print(f"  -> scheduled titles: {titles}")


def case_stability_only():
    print("\nCASE: SOFT stability with competing tasks")

    pref = UserPreference(energy_blocks=[EnergyBlock(9 * 60, 17 * 60, 3)])

    stable_task = Task("Weekly planning", 60, priority=2)
    stable_task.scheduled_blocks = [ScheduledBlock(start=10 * 60, end=11 * 60)]

    competing = [
        Task("Urgent bug fix", 90, priority=1),
        Task("Email follow-ups", 30, priority=3),
    ]

    schedule = schedule_tasks([stable_task] + competing, pref)
    print_schedule(schedule)

    for t, _, interval in schedule:
        if t.title == "Weekly planning":
            dev = abs(interval.start - 10 * 60)
            print(f"    deviation from reference: {dev} min")


def case_fixed_task_with_flexible():
    print("\nCASE: fixed meeting interrupts deep work")

    fixed_task = Task(
        "Team standup",
        duration=30,
        priority=1,
        fixed_window=Interval(15 * 60, 15 * 60 + 30),
    )

    tasks = [
        fixed_task,
        Task("Deep work – feature A", 120, priority=1),
        Task("Code review", 45, priority=2),
        Task("Admin follow-ups", 30, priority=3),
    ]

    pref = UserPreference(
        energy_blocks=[
            EnergyBlock(9 * 60, 12 * 60, energy=3),
            EnergyBlock(13 * 60, 17 * 60, energy=2),
        ]
    )

    schedule = schedule_tasks(tasks, pref)
    print_schedule(schedule)

    fixed = [b for t, _, b in schedule if t.title == "Team standup"]
    assert fixed
    assert fixed[0].start == 15 * 60


def case_preferred_windows():
    print("\nCASE: tasks with preferred windows")

    # Strongly preferred task (must stay in afternoon)
    coding = Task(
        "Deep coding session",
        duration=120,  # may split
        priority=1,
        energy=3,
        preferred_windows=[Interval(14 * 60, 17 * 60)],  # 2pm–5pm
    )

    # Morning routine — short but very time-sensitive
    breakfast = Task(
        "Breakfast & planning",
        duration=30,
        priority=1,
        energy=1,
        preferred_windows=[Interval(7 * 60, 9 * 60)],  # 7am–9am
    )

    # Flexible but important
    emails = Task(
        "Email triage",
        duration=45,
        priority=2,
        energy=1,
    )

    # Medium focus task, prefers late morning
    reading = Task(
        "Read tech articles",
        duration=60,
        priority=2,
        energy=2,
        preferred_windows=[Interval(10 * 60, 12 * 60)],  # 10am–12pm
    )

    # Long flexible task that competes for time
    side_project = Task(
        "Side project work",
        duration=150,  # likely split
        priority=2,
        energy=3,
    )

    # Low-priority filler task
    cleanup = Task(
        "Inbox cleanup",
        duration=30,
        priority=3,
        energy=1,
    )

    pref = UserPreference(
        energy_blocks=[
            EnergyBlock(7 * 60, 10 * 60, energy=1),
            EnergyBlock(10 * 60, 14 * 60, energy=2),
            EnergyBlock(14 * 60, 18 * 60, energy=3),
        ]
    )

    tasks = [
        breakfast,
        emails,
        reading,
        coding,
        side_project,
        cleanup,
    ]

    schedule = schedule_tasks(tasks, pref)
    print_schedule(schedule)

    # ---- Assertions / sanity checks ----

    # Breakfast must be in the morning window
    breakfast_blocks = [b for t, _, b in schedule if t.title == "Breakfast & planning"]
    assert breakfast_blocks, "Breakfast was not scheduled"
    assert all(7 * 60 <= b.start and b.end <= 9 * 60 for b in breakfast_blocks), (
        "Breakfast scheduled outside preferred window"
    )

    # Coding must be in afternoon
    coding_blocks = [b for t, _, b in schedule if t.title == "Deep coding session"]
    assert coding_blocks, "Coding was not scheduled"
    assert all(14 * 60 <= b.start and b.end <= 17 * 60 for b in coding_blocks), (
        "Coding scheduled outside preferred window"
    )

    print("✔ Preferred window constraints respected")


# -------------------------
# Run all
# -------------------------


def run_all():
    case_energy_alignment()
    case_min_gap_only()
    case_task_splitting_behavior()
    case_context_switch_only()
    case_stability_only()
    case_priority_deadline_inclusion()
    case_fixed_task_with_flexible()
    case_preferred_windows()


if __name__ == "__main__":
    run_all()
