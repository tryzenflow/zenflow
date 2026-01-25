from datetime import datetime, timedelta, timezone



def datetime_to_minutes(dt_str: str) -> int:
    """Convert ISO8601 datetime string to minutes since midnight (UTC)."""
    if not dt_str:
        return 0
    dt = datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
    return dt.hour * 60 + dt.minute


def minutes_to_datetime(minutes: int, base_date: datetime | None = None) -> str:
    if base_date is None:
        base_date = datetime.now(timezone.utc).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
    dt = base_date.replace(hour=0, minute=0) + timedelta(minutes=minutes)
    return dt.isoformat() + "Z"


def minutes_to_hhmm(m: int) -> str:
    return f"{m // 60:02d}:{m % 60:02d}"


def get_urgency(deadline_mins: int) -> int:
    """Get urgency score based on deadline."""
    daily_horizon = 24 * 60
    ratio = deadline_mins / daily_horizon
    if ratio == 0:
        return daily_horizon
    return int(daily_horizon / ratio)
