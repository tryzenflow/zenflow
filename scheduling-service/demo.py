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
    available_hours=[Interval(6 * 60, 22 * 60)],   # 6AM–10PM workday
    max_daily_load=6 * 60,
    min_gap_between_tasks=10,
    energy_blocks=energy_blocks,
    batch_similar_tasks=True
)

# === TASKS ===
my_tasks = [
    Task(title="Chess", duration=60, priority=3,
         category='leisure', earliest_start=19 * 60, latest_end=22 * 60, energy_level=3, mandatory=False),

    Task(title="Complete client projects", duration=240, priority=1,
         earliest_start=8 * 60, latest_end=17 * 60, splittable=True, max_splits=2, energy_level=3, category='work'),

    Task(title="Read book", duration=60, priority=3,
         mandatory=False, earliest_start=19 * 60, latest_end=22 * 60, energy_level=2, category='leisure'),

    Task(title='Team Meeting', duration=60, priority=1,
         fixed_start=9 * 60 + 30, mandatory=True, energy_level=2, category='work'),

    Task(title='Lunch', duration=60, priority=2,
         earliest_start=11 * 60, latest_end=13 * 60, energy_level=1, category='eat'),
    Task(id='m.e', title="Morning Exercise", duration=30, priority=1,
         earliest_start=6 * 60, latest_end=8 * 60, energy_level=1, category='health'),
    Task(id='e.e', title="Evening Exercise", duration=30, priority=3,
         earliest_start=17 * 60, latest_end=19 * 60, energy_level=1, category='health'),
    Task(title="Breakfast", duration=60, priority=1,
         earliest_start=6 * 60, prerequisites=['m.e'], latest_end=8 * 60, energy_level=1, category='eat'),
    Task(title='Dinner', duration=60, priority=2,
         earliest_start=17 * 60, prerequisites=['e.e'], latest_end=19 * 60, energy_level=1, category='eat'),
    Task(title='Shower', duration=15, priority=3,
         earliest_start=14 * 60, latest_end=17 * 60, energy_level=1, category='health'),
    Task(title='Nap', duration=15, priority=2,
         earliest_start=12 * 60, mandatory=False, latest_end=14 * 60, energy_level=1, category='health'),
    Task(title="Learn English", duration=60, priority=2,
         mandatory=False, energy_level=2, category='study'),
]


schedule: list[tuple[Task, Interval]] = schedule_tasks(my_tasks, constraints)
schedule.sort(key=lambda x: x[1].start)
if schedule:
  for task, _time in schedule:
    print(f"{task.title}: {_time.start // 60:02d}:{_time.start % 60:02d} - {_time.end // 60:02d}:{_time.end % 60:02d}")
else:
  print("No feasible schedule found.")
