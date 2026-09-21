"""Sync-conflict detection (port of ``sync-conflicts.ts``)."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from .slot import Intervals, overlaps_any


def find_conflicting_task_ids(
    fixed: Intervals, tasks: Sequence[dict[str, Any]]
) -> list[str]:
    if not fixed:
        return []
    return sorted(
        t["id"]
        for t in tasks
        if overlaps_any(
            fixed, t["startMs"], t["startMs"] + t["durationMinutes"] * 60_000
        )
    )
