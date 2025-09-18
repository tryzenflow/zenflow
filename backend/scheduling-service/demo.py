from datetime import datetime
from models import FocusBlock, Interval, Task, Constraints
from scheduler import schedule_tasks
from google.protobuf.timestamp_pb2 import Timestamp

focus_blocks = [
    FocusBlock(level=1, interval=Interval(6 * 60, 8 * 60)),
    FocusBlock(level=3, interval=Interval(8 * 60, 11 * 60)),
    FocusBlock(level=1, interval=Interval(11 * 60, 14 * 60)),
    FocusBlock(level=2, interval=Interval(14 * 60, 17 * 60)),
    FocusBlock(level=1, interval=Interval(17 * 60, 19 * 60)),
    FocusBlock(level=2, interval=Interval(19 * 60, 21 * 60)),
    FocusBlock(level=1, interval=Interval(21 * 60, 22 * 60)),
]

constraints = Constraints(
    available_hours=[Interval(6 * 60, 22 * 60)],   # 6AM–10PM workday
    max_daily_load=6 * 60,
    min_gap_between_tasks=10,
    focus_blocks=focus_blocks,
    batch_similar_tasks=True
)

# === TASKS ===
my_tasks = [
    Task(title="Chess", duration=60, priority=3,
         category='leisure', earliest_start=19 * 60, latest_end=22 * 60, focus=3, mandatory=False),

    # f1338e50-0de6-4bd2-bc97-e561c7beaa70
    Task(title="Complete client projects", duration=240, priority=1,
         earliest_start=8 * 60, deadline=datetime(2025, 10, 12), latest_end=17 * 60, max_splits=2, focus=3, category='work'),

    Task(title="Read book", duration=60, priority=3,
         mandatory=False, earliest_start=19 * 60, latest_end=22 * 60, focus=2, category='leisure'),

    Task(title='Team Meeting', duration=60, priority=1,
         earliest_start=9 * 60 + 30, latest_end=10 * 60 + 30, mandatory=True, focus=2, category='work'),

    Task(title='Lunch', duration=60, priority=2,
         earliest_start=11 * 60, latest_end=13 * 60, focus=1, category='eat'),

    # 183a229c-37ac-430d-bbb0-2eb70bf5874f
    Task(id='m.e', title="Morning Exercise", duration=30, priority=1,
         earliest_start=6 * 60, latest_end=8 * 60, focus=1, category='health'),
    Task(id='e.e', title="Evening Exercise", duration=30, priority=3,
         earliest_start=17 * 60, latest_end=19 * 60, focus=1, category='health'),

    # 0ea8204c-edbc-468b-8f4f-980cdaa61482
    Task(title="Breakfast", duration=60, priority=1,
         earliest_start=6 * 60, prerequisites=['m.e'], latest_end=8 * 60, focus=1, category='eat'),
    Task(title='Dinner', duration=60, priority=2,
         earliest_start=17 * 60, prerequisites=['e.e'], latest_end=19 * 60, focus=1, category='eat'),
    Task(title='Shower', duration=15, priority=3,
         earliest_start=13 * 60, latest_end=15 * 60, focus=1, category='health'),
    Task(title='Nap', duration=15, priority=2,
         earliest_start=12 * 60, mandatory=False, latest_end=14 * 60, focus=1, category='health'),
    Task(title="Learn English", duration=60, priority=2,
         mandatory=False, focus=2, category='study'),
]


schedule: list[tuple[Task, int, Interval]
               ] = schedule_tasks(my_tasks, constraints)
schedule.sort(key=lambda x: x[2].start)
if schedule:
  for task, split, _time in schedule:
    print(f"{task.title} (split {split + 1}): {_time.start // 60:02d}:{_time.start % 60:02d} - {_time.end // 60:02d}:{_time.end % 60:02d}")
else:
  print("No feasible schedule found.")
