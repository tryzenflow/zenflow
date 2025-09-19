from typing import Optional
from datetime import datetime


class Interval:
  def __init__(self, start: int, end: int) -> None:
    self.start = start
    self.end = end


class Schedule:
  def __init__(self, start: int, end: int, split: int = 0) -> None:
    self.split = split
    self.start = start
    self.end = end


class Task:
  def __init__(
      self,
      title: str,
      duration: int,
      priority: int = 3,  # 1-3 (lower = more important)
      id: str | None = None,
      earliest_start: int | None = None,
      latest_end: int | None = None,
      deadline: datetime | None = None,
      mandatory: bool = True,
      max_splits: int = 1,
      category: str | None = None,
      prerequisites: list[str] = [],
      schedules: list[Schedule] = [],
      focus: int = 1  # 1-3 (higher = more mentally demanding)
  ) -> None:
    from uuid import uuid4
    self.id = id or str(uuid4())
    self.title = title
    self.duration = duration
    self.priority = priority
    self.earliest_start = earliest_start
    self.latest_end = latest_end
    self.deadline = deadline
    self.mandatory = mandatory
    self.max_splits = max_splits
    # a list of task IDs to be completed before this task
    self.prerequisites = prerequisites
    self.focus = focus
    self.schedules = schedules
    self.category = category

    self.schedules.sort(key=lambda x: x.split)

  def __str__(self) -> str:
    return f'{self.id} - {self.title} ({self.duration} min) - earliest_start: {self.earliest_start}, latest_end: {self.latest_end}'


class FocusBlock:
  def __init__(self, level: int, interval: Interval) -> None:
    self.level = level
    self.interval = interval


class Constraints:
  def __init__(self, available_hours: list[Interval], min_gap_between_tasks: int, focus_blocks: list[FocusBlock], batch_similar_tasks: bool = True, max_daily_load: int = 24 * 60) -> None:
    self.max_daily_load = max_daily_load
    self.available_hours = available_hours
    self.min_gap_between_tasks = min_gap_between_tasks
    self.focus_blocks = focus_blocks
    self.batch_similar_tasks = batch_similar_tasks
