from typing import List, Optional
from uuid import uuid4

from utils import minutes_to_hhmm

TIME_GRANULARITY = 15


class EnergyBlock:
    def __init__(self, start: int, end: int, energy: int) -> None:
        assert start < end
        self.start = start
        self.end = end
        self.energy = energy  # 1 (low) → 3 (high)

    def __repr__(self) -> str:
        formatted_start = minutes_to_hhmm(self.start)
        formatted_end = minutes_to_hhmm(self.end)
        return f"EnergyBlock(start={formatted_start}, end={formatted_end}, energy={self.energy})"


class Interval:
    def __init__(self, start: int, end: int) -> None:
        assert start < end
        self.start = start
        self.end = end

    def __repr__(self) -> str:
        formatted_start = minutes_to_hhmm(self.start)
        formatted_end = minutes_to_hhmm(self.end)
        return f"Interval(start={formatted_start}, end={formatted_end})"


class ScheduledBlock:
    def __init__(
        self,
        start: int,
        end: int,
        split_index: int = 0,
    ) -> None:
        self.start = start
        self.end = end
        self.split_index = split_index

    def __repr__(self) -> str:
        formatted_start = minutes_to_hhmm(self.start)
        formatted_end = minutes_to_hhmm(self.end)
        return f"ScheduledBlock(start={formatted_start}, end={formatted_end}, split_index={self.split_index})"


class Task:
    def __init__(
        self,
        title: str,
        duration: int,
        deadline: Optional[int] = None,  # minutes since midnight
        energy: int = 2,
        category: Optional[str] = None,
        id: Optional[str] = None,
        max_splits: Optional[int] = None,
        scheduled_blocks: List[ScheduledBlock] = [],
        fixed_window: Optional["Interval"] = None,  # hard time block
    ) -> None:
        assert duration % TIME_GRANULARITY == 0

        self.id = id or str(uuid4())
        self.title = title
        self.duration = duration
        self.deadline = deadline or None
        self.energy = energy or 1
        self.category = category or "default"

        self.max_splits = max_splits or self._infer_max_splits()
        self.scheduled_blocks = scheduled_blocks
        self.fixed_window = fixed_window

    def _infer_max_splits(self) -> int:
        if self.duration <= 60:
            return 1
        if self.duration <= 120:
            return 2
        if self.duration <= 180:
            return 3
        return 4

    def scheduled_duration(self) -> int:
        return sum(b.end - b.start for b in self.scheduled_blocks)

    def __repr__(self) -> str:
        return f"Task(id={self.id}, title={self.title}, duration={self.duration}, max_splits={self.max_splits}, energy={self.energy}, category={self.category}, max_splits={self.max_splits}, scheduled_blocks={self.scheduled_blocks}, fixed_window={self.fixed_window})"


class UserPreference:
    def __init__(
        self,
        min_gap_between_tasks: int = 0,  # soft
        energy_blocks: Optional[List[EnergyBlock]] = None,
    ) -> None:
        self.min_gap_between_tasks = min_gap_between_tasks
        self.energy_blocks = energy_blocks or []

    def __repr__(self) -> str:
        return f"UserPreference(min_gap_between_tasks={self.min_gap_between_tasks}, energy_blocks={self.energy_blocks})"
