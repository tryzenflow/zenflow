"""The alpha sweep: ``BANDIT_ALPHA`` is the only parameter swept (ADR-0001 §10).

Ridge, learning rates, decay and every other constant stay at their defaults, so
the sweep is a sensitivity check of the shipped exploration width, not a tuning
of the whole model. The heuristic world does not depend on alpha and is run once.
"""

from __future__ import annotations

from dataclasses import replace

from .engine import SimConfig

DEFAULT_ALPHAS = (0.0, 0.05, 0.15, 0.3, 0.6, 1.0)  # 0.15 = shipped default


def with_sweep(cfg: SimConfig, alphas: tuple[float, ...] = DEFAULT_ALPHAS) -> SimConfig:
    return replace(cfg, alphas=alphas)


def sweep_rows(report: dict[str, object]) -> list[dict[str, float]]:
    """Flat per-alpha rows (regret / acceptance / drag diffs and the cold and warm
    regret diffs, each with its CI) from a report that has an ``alpha_sweep``."""
    raw = report.get("alpha_sweep")
    if not isinstance(raw, list):
        return []
    rows: list[dict[str, float]] = []
    for entry in raw:
        o, c, w = entry["overall"], entry["cold_0_5"], entry["warm_40_plus"]
        rows.append(
            {
                "alpha": float(entry["alpha"]),
                "regret_h": o["regret"]["heuristic"],
                "regret_l": o["regret"]["linucb"],
                "regret_diff": o["regret"]["diff"],
                "regret_lo": o["regret"]["ci95"][0],
                "regret_hi": o["regret"]["ci95"][1],
                "accept_diff": o["accept"]["diff"],
                "drag_diff": o["drag"]["diff"],
                "cold_regret_diff": c["regret"]["diff"]
                if "regret" in c
                else float("nan"),
                "warm_regret_diff": w["regret"]["diff"]
                if "regret" in w
                else float("nan"),
            }
        )
    return rows
