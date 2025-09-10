from typing import Optional
from datetime import datetime


class Interval:
  def __init__(self, start: int, end: int) -> None:
    self.start = start
    self.end = end


class Task:
  def __init__(
      self,
      title: str,
      duration: int,
      priority: int = 3,  # 1-3 (lower = more important)
      id: Optional[str] = None,
      fixed_start: Optional[int] = None,
      earliest_start: Optional[int] = None,
      latest_end: Optional[int] = None,
      deadline: Optional[datetime] = None,
      splittable: bool = False,
      mandatory: bool = True,
      max_splits: int = 1,
      category: Optional[str] = None,
      prerequisites: list[str] = [],
      energy_level: int = 1  # 1-3 (higher = more mentally demanding)
  ) -> None:
    if fixed_start and (earliest_start or latest_end):
      raise ValueError(
          '`fixed_start` cannot co-exist with `earliest_start` or `preferred_times`'
      )
    if fixed_start and (splittable or max_splits > 1):
      raise ValueError('Tasks with `fixed_start` cannot be split')
    from uuid import uuid4
    self.id = id or str(uuid4())
    self.title = title
    self.duration = duration
    self.priority = priority
    self.fixed_start = fixed_start
    self.earliest_start = earliest_start
    self.latest_end = latest_end
    self.deadline = deadline
    self.mandatory = mandatory
    self.splittable = splittable
    self.max_splits = max_splits
    # a list of task IDs to be completed before this task
    self.prerequisites = prerequisites
    self.energy_level = energy_level
    self.category = category

  def __str__(self) -> str:
    return f'{self.id} - {self.title} ({self.duration} min) - Fixed start: {self.fixed_start}, earliest_start: {self.earliest_start}, latest_end: {self.latest_end}, deadline: {self.deadline}, priority: {self.priority}'


class EnergyBlock:
  def __init__(self, energy_level: int, interval: Interval) -> None:
    self.energy_level = energy_level
    self.interval = interval


class Constraints:
  def __init__(self, available_hours: list[Interval], min_gap_between_tasks: int, energy_blocks: list[EnergyBlock], batch_similar_tasks: bool = True, max_daily_load: int = 24 * 60) -> None:
    self.max_daily_load = max_daily_load
    self.available_hours = available_hours
    self.min_gap_between_tasks = min_gap_between_tasks
    self.energy_blocks = energy_blocks
    self.batch_similar_tasks = batch_similar_tasks
