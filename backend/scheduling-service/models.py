from datetime import datetime
from typing import List, Optional
from uuid import uuid4

TIME_GRANULARITY = 15


class EnergyBlock:
    def __init__(self, start: int, end: int, energy: int) -> None:
        assert start < end
        self.start = start
        self.end = end
        self.energy = energy  # 1 (low) → 3 (high)


class Interval:
    def __init__(self, start: int, end: int) -> None:
        assert start < end
        self.start = start
        self.end = end


class ScheduledBlock:
    def __init__(self, start: int, end: int, split_index: int = 0) -> None:
        self.start = start
        self.end = end
        self.split_index = split_index


class Task:
    def __init__(
        self,
        title: str,
        duration: int,
        priority: Optional[int] = None,
        deadline: Optional[datetime] = None,
        energy: int = 2,
        category: Optional[str] = None,
        id: Optional[str] = None,
        scheduled_blocks: List[ScheduledBlock] = [],
    ) -> None:
        assert duration % TIME_GRANULARITY == 0

        self.id = id or str(uuid4())
        self.title = title
        self.duration = duration
        self.priority = priority or 2
        self.deadline = deadline
        self.deadline_weight = int(bool(self.deadline))
        self.energy = energy or 1
        self.category = category or "default"

        self.max_splits = self._infer_max_splits()
        self.scheduled_blocks = scheduled_blocks

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


class UserPreference:
    def __init__(
        self,
        available_hours: List[Interval],
        min_gap_between_tasks: int = 0,  # soft
        energy_blocks: Optional[List[EnergyBlock]] = None,
    ) -> None:
        self.available_hours = available_hours
        self.min_gap_between_tasks = min_gap_between_tasks
        self.energy_blocks = energy_blocks or []
