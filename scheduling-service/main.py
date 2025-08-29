from models import EnergyBlock, Interval, Task, Constraints
from scheduler import schedule_tasks

# === ENERGY BLOCKS (user's daily energy profile) ===
energy_blocks = [
    EnergyBlock(energy_level=1, interval=Interval(6 * 60, 8 * 60)),
    EnergyBlock(energy_level=3, interval=Interval(8 * 60, 11 * 60)),
    EnergyBlock(energy_level=1, interval=Interval(11 * 60, 14 * 60)),
    EnergyBlock(energy_level=2, interval=Interval(14 * 60, 17 * 60)),
    EnergyBlock(energy_level=1, interval=Interval(17 * 60, 19 * 60)),
    EnergyBlock(energy_level=2, interval=Interval(19 * 60, 21 * 60)),
    EnergyBlock(energy_level=1, interval=Interval(21 * 60, 22 * 60)),
]

constraints = Constraints(
    available_hours=Interval(6 * 60, 22 * 60),   # 6AM–10PM workday
    min_gap_between_tasks=10,      # 15 min gap between tasks
    energy_blocks=energy_blocks,
    batch_similar_tasks=True
)

# === TASKS ===
my_tasks = [
    Task(title="Chess", duration=60, priority=4,
         category='leisure', energy_level=2, mandatory=False),

    Task(title="Complete client projects", duration=100, priority=1,
         earliest_start=8 * 60, splittable=True, max_splits=3, latest_end=17 * 60, energy_level=3, category='work'),

    Task(title="Read book", duration=60, priority=3,
         mandatory=False, energy_level=2, category='leisure'),

    Task(title='Team Meeting', duration=60, priority=1,
         fixed_start=9 * 60 + 30, mandatory=True, energy_level=2, category='work'),

    Task(title='Make Breakfast', duration=15, priority=2,
         earliest_start=6 * 60, latest_end=7 * 60, energy_level=1, category='cooking'),
    Task(title='Cook Lunch', duration=30, priority=2,
         earliest_start=11 * 60, latest_end=12 * 60, energy_level=1, category='cooking'),
    Task(title='Cook Dinner', duration=30, priority=2,
         earliest_start=17 * 60, latest_end=18 * 60 + 30, energy_level=1, category='cooking'),
    Task(title='Lunch', duration=30, priority=2,
         earliest_start=11 * 60 + 30, latest_end=12 * 60 + 30, energy_level=1, category='eat'),
    Task(title="Morning Exercise", duration=30, priority=1,
         earliest_start=6 * 60, latest_end=7 * 60 + 30, energy_level=1, category='health'),
    Task(title="Evening Exercise", duration=30, priority=3,
         earliest_start=17 * 60, latest_end=18 * 60, energy_level=1, category='health'),
    Task(title="Breakfast", duration=30, priority=1,
         earliest_start=6 * 60 + 30, latest_end=8 * 60, energy_level=1, category='eat'),
    Task(title='Dinner', duration=30, priority=2,
         earliest_start=17 * 60, latest_end=19 * 60, energy_level=1, category='eat'),
    Task(title='Shower', duration=15, priority=3,
         earliest_start=14 * 60, latest_end=17 * 60, energy_level=1, category='health'),
    Task(title='Nap', duration=15, priority=2,
         earliest_start=13 * 60, mandatory=True, latest_end=14 * 60, energy_level=1, category='health'),
    Task(title="Learn English", duration=60, priority=2,
         mandatory=False, energy_level=2, category='study'),
]

tasks = [
    # ----------- WORK -----------
    Task(title="Write project report", duration=120, priority=1,
         earliest_start=9 * 60, latest_end=17 * 60, splittable=True, max_splits=2,
         energy_level=3, category='work'),

    Task(title="Prepare client slides", duration=90, priority=2,
         earliest_start=9 * 60, latest_end=17 * 60, splittable=True, max_splits=2,
         energy_level=3, category='work', mandatory=False),

    Task(title="Code review", duration=60, priority=2,
         earliest_start=10 * 60, latest_end=17 * 60, splittable=True, max_splits=2,
         energy_level=3, category='work', mandatory=False),

    Task(title="Fix small bug", duration=45, priority=2,
         earliest_start=10 * 60, latest_end=17 * 60,
         energy_level=2, category='work', mandatory=False),

    # ----------- ADMIN -----------
    Task(title="Reply to emails", duration=45, priority=3,
         energy_level=1, category='admin', mandatory=False),

    Task(title="File receipts", duration=30, priority=3,
         energy_level=1, category='admin', mandatory=False),

    Task(title="Plan grocery shopping", duration=20, priority=3,
         earliest_start=18 * 60, latest_end=20 * 60,
         energy_level=1, category='admin', mandatory=False),

    # ----------- CREATIVE -----------
    Task(title="Brainstorm new feature", duration=60, priority=2,
         splittable=True, max_splits=2,
         energy_level=3, category='creative', mandatory=False),

    Task(title="Design mockups", duration=90, priority=2,
         splittable=True, max_splits=2,
         energy_level=3, category='creative', mandatory=False),

    # ----------- CHORE -----------
    Task(title="Laundry", duration=40, priority=3,
         earliest_start=18 * 60, latest_end=22 * 60,
         energy_level=1, category='chore', mandatory=False),
]

schedule: list[tuple[Task, Interval]] = schedule_tasks(my_tasks, constraints)
schedule.sort(key=lambda x: x[1].start)
if schedule:
  for task, _time in schedule:
    print(f"{task.title}: {_time.start // 60:02d}:{_time.start % 60:02d} - {_time.end // 60:02d}:{_time.end % 60:02d}")
else:
  print("No feasible schedule found.")
