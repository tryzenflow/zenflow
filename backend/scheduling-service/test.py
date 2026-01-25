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
            f"deadline={task.deadline} energy={task.energy} cat={task.category}"
        )


def overlap(a: Interval, b: Interval) -> int:
    return max(0, min(a.end, b.end) - max(a.start, b.start))


# -------------------------
# HARD CONSTRAINT TESTS
# -------------------------


def case_task_splitting_behavior():
    print("\nCASE: task splitting")

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
            energy=3,
        ),
        Task(
            "Design review notes",
            duration=120,  # medium focus
            energy=2,
        ),
        Task(
            "Email inbox cleanup",
            duration=30,  # short admin
            energy=1,
        ),
        Task(
            "Slack follow-ups",
            duration=15,  # very short admin
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
    print("\nCASE: energy alignment behavior")

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
        ),
        # Low-energy admin, should be pushed into slump
        Task(
            "Email & paperwork",
            duration=60,
            energy=1,
        ),
        # Medium-energy creative task
        Task(
            "Product design",
            duration=90,
            energy=2,
        ),
        # Slight mismatch task (energy=2 but competes with peak)
        Task(
            "Code review",
            duration=60,
            energy=2,
        ),
        # Short filler task (can go anywhere)
        Task(
            "Inbox cleanup",
            duration=30,
            energy=1,
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
        Task(
            "Slack replies",
            15,
        ),
        Task(
            "Expense receipt upload",
            15,
        ),
        Task(
            "Quick status update",
            15,
        ),
        Task(
            "Bug triage",
            30,
        ),
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
        Task(
            "Client call A",
            30,
            category="calls",
        ),
        Task(
            "Client call B",
            30,
            category="calls",
        ),
        Task(
            "Recruiter call",
            15,
            category="calls",
        ),
        # Writing (deep work)
        Task(
            "Write proposal",
            90,
            category="writing",
        ),
        Task(
            "Documentation update",
            60,
            category="writing",
        ),
        # Admin (low urgency fillers)
        Task(
            "Invoice review",
            30,
            category="admin",
        ),
        Task(
            "CRM cleanup",
            30,
            category="admin",
        ),
    ]

    schedule = schedule_tasks(tasks, pref)
    print_schedule(schedule)

    metrics = context_switch_metrics(schedule)
    print(f"  -> context switches: {metrics['switches']}")
    print(f"  -> same-category batches: {metrics['batches']}")


def case_stability_only():
    print("\nCASE: SOFT stability with competing tasks")

    pref = UserPreference(energy_blocks=[EnergyBlock(9 * 60, 17 * 60, 3)])

    stable_task = Task(
        "Weekly planning",
        60,
    )
    stable_task.scheduled_blocks = [ScheduledBlock(start=10 * 60, end=11 * 60)]

    competing = [
        Task(
            "Urgent bug fix",
            90,
        ),
        Task(
            "Email follow-ups",
            30,
        ),
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
        fixed_window=Interval(15 * 60, 15 * 60 + 30),
    )

    tasks = [
        fixed_task,
        Task(
            "Deep work – feature A",
            120,
        ),
        Task(
            "Code review",
            45,
        ),
        Task(
            "Admin follow-ups",
            30,
        ),
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


def case_energy_deadline():
    print("\nCASE: deadline (today vs future) + energy alignment")

    pref = UserPreference(
        energy_blocks=[
            EnergyBlock(start=9 * 60, end=10 * 60, energy=3),  # morning high energy
            EnergyBlock(
                start=14 * 60, end=15 * 60, energy=2
            ),  # afternoon medium energy
        ]
    )

    tasks = [
        # -------- TODAY (hard deadlines) --------
        Task(
            "Today – Very urgent, high energy",
            duration=60,
            deadline=9 * 60 + 30,  # 09:30
            energy=3,
        ),
        Task(
            "Today – Less urgent, high energy",
            duration=60,
            deadline=11 * 60,  # 11:00
            energy=3,
        ),
        Task(
            "Today – Medium energy",
            duration=60,
            deadline=15 * 60,  # 15:00
            energy=2,
        ),
        # -------- FUTURE (soft ASAP) --------
        Task(
            "Future – High energy",
            duration=60,
            deadline=2 * 1440 + 600,  # 2 days later
            energy=3,
        ),
        Task(
            "Future – Medium energy",
            duration=60,
            deadline=3 * 1440 + 900,  # 3 days later
            energy=2,
        ),
        # -------- NO ENERGY MATCH --------
        Task(
            "No matching energy",
            duration=60,
            energy=1,
        ),
    ]

    schedule = schedule_tasks(tasks, pref)
    print_schedule(schedule)

    # ----------------------------
    # Analysis
    # ----------------------------
    print("\nDeadline + energy alignment analysis:")
    for t, _, block in schedule:
        overlaps = [
            max(0, min(block.end, b.end) - max(block.start, b.start))
            for b in pref.energy_blocks
            if b.energy == t.energy
        ]
        aligned_minutes = sum(overlaps)

        deadline_type = (
            "TODAY"
            if t.deadline is not None and t.deadline < 1440
            else "FUTURE"
            if t.deadline is not None
            else "NONE"
        )

        print(
            f"{t.title:35} | "
            f"{block.start:4}-{block.end:4} | "
            f"aligned: {aligned_minutes:3} mins | "
            f"deadline: {t.deadline} ({deadline_type}) | "
            f"energy: {t.energy}"
        )

    print("\nExpected behavior:")
    print("- Today tasks finish before their deadlines")
    print("- Earlier deadlines scheduled earlier")
    print("- Urgent high-energy tasks align with 9–10 block")
    print("- Future tasks prefer energy alignment over exact timing")
    print("- Tasks with no matching energy are placed flexibly")


def case_energy_multi_level_fallback():
    print("\nCASE: multi-level energy fallback (high → medium → low → outside)")

    pref = UserPreference(
        energy_blocks=[
            # High energy (limited)
            EnergyBlock(start=9 * 60, end=10 * 60, energy=3),  # 60
            EnergyBlock(start=15 * 60, end=15 * 60 + 30, energy=3),  # 30
            # Medium energy
            EnergyBlock(start=10 * 60, end=12 * 60, energy=2),  # 120
            EnergyBlock(start=14 * 60, end=15 * 60, energy=2),  # 60
            # Low energy (large)
            EnergyBlock(start=12 * 60, end=14 * 60, energy=1),  # 120
            EnergyBlock(start=16 * 60, end=18 * 60, energy=1),  # 120
        ]
    )

    tasks = [
        # 6 identical high-energy tasks → 360 minutes total
        Task("Deep Work A", duration=60, energy=3),
        Task("Deep Work B", duration=60, energy=3),
        Task("Deep Work C", duration=60, energy=3),
        Task("Deep Work D", duration=60, energy=2),
        Task("Deep Work E", duration=60, energy=2),
        Task("Deep Work F", duration=60, energy=1),
    ]

    schedule = schedule_tasks(tasks, pref)
    print_schedule(schedule)

    # ----------------------------
    # Energy distribution analysis
    # ----------------------------
    print("\nEnergy distribution analysis:")

    for t, _, block in schedule:
        match = med = low = outside = 0

        for b in pref.energy_blocks:
            overlap = max(
                0,
                min(block.end, b.end) - max(block.start, b.start),
            )

            if b.energy == t.energy:
                match += overlap
            elif b.energy == 2:
                med += overlap
            elif b.energy == 1:
                low += overlap

        outside = t.duration - (match + med + low)

        print(
            f"{t.title:15} | "
            f"{block.start:4}-{block.end:4} | "
            f"H:{match:3}  M:{med:3}  L:{low:3}  O:{outside:3}"
        )

    print("\nExpected behavior:")
    print("- High energy blocks fill first (≈90 mins total)")
    print("- Medium energy absorbs overflow next")
    print("- Low energy absorbs remaining tasks")
    print("- Outside usage should be minimal or zero")


# -------------------------
# Run all
# -------------------------


def run_all():
    case_energy_alignment()
    case_min_gap_only()
    case_task_splitting_behavior()
    case_context_switch_only()
    case_stability_only()
    case_fixed_task_with_flexible()
    case_energy_deadline()
    case_energy_multi_level_fallback()


if __name__ == "__main__":
    run_all()
