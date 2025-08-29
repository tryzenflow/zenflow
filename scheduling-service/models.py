from typing import Optional


class Interval:
  def __init__(self, start: int, end: int) -> None:
    self.start = start
    self.end = end


class Task:
  def __init__(
      self,
      title: str,
      duration: int,
      priority: int,
      fixed_start: Optional[int] = None,
      earliest_start: Optional[int] = None,
      latest_end: Optional[int] = None,
      splittable: bool = False,
      mandatory: bool = True,
      max_splits: int = 1,
      category: Optional[str] = None,
      energy_level: int = 3
  ) -> None:
    if fixed_start and (earliest_start or latest_end):
      raise ValueError(
          '`fixed_start` cannot co-exist with `earliest_start` or `preferred_times`'
      )
    if fixed_start and (splittable or max_splits > 1):
      raise ValueError('Tasks with `fixed_start` cannot be split')
    from uuid import uuid4
    self.id = str(uuid4())
    self.title = title
    self.duration = duration
    self.priority = priority
    self.fixed_start = fixed_start
    self.earliest_start = earliest_start
    self.latest_end = latest_end
    self.mandatory = mandatory
    self.splittable = splittable
    self.max_splits = max_splits
    self.energy_level = energy_level
    self.category = category


class EnergyBlock:
  def __init__(self, energy_level: int, interval: Interval) -> None:
    self.energy_level = energy_level
    self.interval = interval


class Constraints:
  def __init__(self, available_hours: Interval, min_gap_between_tasks: int, energy_blocks: list[EnergyBlock], batch_similar_tasks: bool = True) -> None:
    self.available_hours = available_hours
    self.min_gap_between_tasks = min_gap_between_tasks
    self.energy_blocks = energy_blocks
    self.batch_similar_tasks = batch_similar_tasks
