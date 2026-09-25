"""Slot / calendar math (port of ``slot.ts``). Instants are epoch ms ints."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from functools import lru_cache
from zoneinfo import ZoneInfo

import numpy as np
from numpy.typing import NDArray

from .constants import DAY_MS, SLOT_MS

Intervals = list[tuple[int, int]]


@lru_cache(maxsize=64)
def _zone(timezone: str) -> ZoneInfo:
    return ZoneInfo(timezone)


def local_date_str(ms: int, timezone: str) -> str:
    """``YYYY-MM-DD`` of the instant in ``timezone``."""
    dt = datetime.fromtimestamp(ms // 1000, tz=_zone(timezone))
    return dt.date().isoformat()


def deadline_day_str(deadline_ms: int, timezone: str) -> str:
    return local_date_str(deadline_ms - 1, timezone)


def local_midnight_ms(date_str: str, timezone: str) -> int:
    """UTC epoch ms of local 00:00 on ``date_str`` (first occurrence if ambiguous)."""
    d = date.fromisoformat(date_str)
    dt = datetime(d.year, d.month, d.day, tzinfo=_zone(timezone))
    return int(dt.timestamp()) * 1000


def add_days_str(date_str: str, n: int) -> str:
    return (date.fromisoformat(date_str) + timedelta(days=n)).isoformat()


def day_diff_str(a: str, b: str) -> int:
    return (date.fromisoformat(b) - date.fromisoformat(a)).days


def iso_weekday(date_str: str) -> int:
    """ISO weekday 1=Mon .. 7=Sun."""
    return date.fromisoformat(date_str).isoweekday()


def utc_to_minutes(ms: int, timezone: str) -> int:
    """Local minute-of-day of the instant."""
    dt = datetime.fromtimestamp(ms // 1000, tz=_zone(timezone))
    return dt.hour * 60 + dt.minute


def ceil_to_slot(ms: int) -> int:
    return -((-ms) // SLOT_MS) * SLOT_MS


def floor_to_slot(ms: int) -> int:
    return (ms // SLOT_MS) * SLOT_MS


def overlaps_any(occupied: Intervals, a_start: int, a_end: int) -> bool:
    return any(a_start < e and a_end > s for s, e in occupied)


# ---- vectorized helpers -------------------------------------------------

_OFFSET_CHUNK = 96  # slots per cached chunk (one UTC day)
_offset_cache: dict[tuple[str, int], NDArray[np.int64]] = {}


def _chunk_offsets(timezone: str, chunk: int) -> NDArray[np.int64]:
    key = (timezone, chunk)
    hit = _offset_cache.get(key)
    if hit is not None:
        return hit
    zone = _zone(timezone)
    base = chunk * _OFFSET_CHUNK * SLOT_MS // 1000
    out = np.empty(_OFFSET_CHUNK, dtype=np.int64)
    for i in range(_OFFSET_CHUNK):
        local = datetime.fromtimestamp(base + i * SLOT_MS // 1000, tz=UTC).astimezone(
            zone
        )
        delta = local.utcoffset()
        assert delta is not None
        out[i] = int(delta.total_seconds()) * 1000
    _offset_cache[key] = out
    return out


def utc_offsets_ms(first_slot: int, n_slots: int, timezone: str) -> NDArray[np.int64]:
    """UTC offset (ms) at the start of ``n_slots`` consecutive 15-min slots
    beginning at absolute slot index ``first_slot`` (``ms // SLOT_MS``)."""
    c0 = first_slot // _OFFSET_CHUNK
    c1 = (first_slot + n_slots - 1) // _OFFSET_CHUNK
    joined = np.concatenate([_chunk_offsets(timezone, c) for c in range(c0, c1 + 1)])
    lo = first_slot - c0 * _OFFSET_CHUNK
    return joined[lo : lo + n_slots]


def local_cells(first_slot: int, n_slots: int, timezone: str) -> NDArray[np.int64]:
    """Flat 7x24 preference-matrix cell index for each consecutive slot."""
    starts = (first_slot + np.arange(n_slots, dtype=np.int64)) * SLOT_MS
    local = starts + utc_offsets_ms(first_slot, n_slots, timezone)
    days = local // DAY_MS
    weekday0 = (days + 3) % 7  # 1970-01-01 was a Thursday (ISO 4 -> index 3)
    hour = (local % DAY_MS) // (60 * 60_000)
    return weekday0 * 24 + hour
