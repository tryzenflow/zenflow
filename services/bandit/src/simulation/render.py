"""Markdown rendering of a simulation report (deterministic: no timestamps)."""

from __future__ import annotations

from typing import Any

from .sweep import sweep_rows


def _ci(m: dict[str, Any], digits: int = 3) -> str:
    lo, hi = m["ci95"]
    return f"{m['diff']:+.{digits}f} [{lo:+.{digits}f}, {hi:+.{digits}f}]"


def _metric_row(name: str, m: dict[str, Any], digits: int = 3) -> str:
    return (
        f"| {name} | {m['heuristic']:.{digits}f} | {m['linucb']:.{digits}f} | "
        f"{_ci(m, digits)} | {m['wilcoxon_p']:.3f} | {m['cliffs_delta']:+.2f} |"
    )


def _head(cols: list[str]) -> list[str]:
    return ["| " + " | ".join(cols) + " |", "|" + "|".join(["---"] * len(cols)) + "|"]


def _compact(label: str, a: dict[str, Any]) -> str:
    if "regret" not in a:
        return f"| {label} | 0 | 0 | - | - | - | - | - | - | - | - |"
    r, c, d = a["regret"], a["accept"], a["drag"]
    return (
        f"| {label} | {a['n_students']} | {a['n_placements']} | "
        f"{r['heuristic']:.3f} | {r['linucb']:.3f} | {_ci(r)} | "
        f"{c['heuristic']:.3f} | {c['linucb']:.3f} | {_ci(c)} | "
        f"{d['heuristic']:.1f} | {d['linucb']:.1f} |"
    )


_COMPACT_COLS = [
    "slice",
    "students",
    "placements",
    "regret H",
    "regret L",
    "regret diff [95% CI]",
    "accept H",
    "accept L",
    "accept diff [95% CI]",
    "drag H (min)",
    "drag L (min)",
]


def render_markdown(report: dict[str, Any]) -> str:
    cfg = report["config"]
    out: list[str] = [
        f"# Simulation report (seed {cfg['seed']})",
        "",
        f"{cfg['students']} students x {len(cfg['scenarios'])} scenarios, "
        f"{cfg['events_per_student']} arrival events each; LinUCB alpha "
        f"{cfg['primary_alpha']:g}, ridge {cfg['ridge']:g}. {report['convention']}.",
        "",
        "## Overall",
        "",
        *_head(
            [
                "metric",
                "heuristic",
                "LinUCB",
                "diff [95% CI]",
                "Wilcoxon p",
                "Cliff's d",
            ]
        ),
    ]
    o = report["overall"]
    ttt0 = report["time_to_threshold"][cfg["scenarios"][0]]
    out += [
        _metric_row("regret vs oracle", o["regret"]),
        _metric_row("acceptance", o["accept"]),
        _metric_row("drag (min)", o["drag"], 1),
        "",
        f"Divergence: the policies chose different starts for "
        f"{o['divergence']['rate']:.1%} of paired placements "
        f"(95% CI {o['divergence']['ci95'][0]:.1%}-{o['divergence']['ci95'][1]:.1%}); "
        f"mean start gap {o['divergence']['mean_start_gap_min']:.0f} min.",
        "",
        "## By scenario",
        "",
        *_head(_COMPACT_COLS),
        *[_compact(n, a) for n, a in report["by_scenario"].items()],
        "",
        "## Cold-start buckets (prior interactions of the student)",
        "",
        *_head(_COMPACT_COLS),
        *[_compact(n, a) for n, a in report["by_bucket"].items()],
        "",
        "## Time to threshold",
        "",
        f"Placements until the rolling-{ttt0['window']} acceptance reaches "
        f"{ttt0['threshold']:.0%}"
        " (censored at the horizon when it never does).",
        "",
        *_head(
            [
                "scenario",
                "reached H",
                "reached L",
                "median H",
                "median L",
                "mean diff [95% CI]",
                "Wilcoxon p",
                "Cliff's d",
            ]
        ),
    ]
    for n, t in report["time_to_threshold"].items():
        out.append(
            f"| {n} | {t['reached_heuristic']:.0%} | {t['reached_linucb']:.0%} | "
            f"{t['median_heuristic']:.0f} | {t['median_linucb']:.0f} | "
            f"{t['mean_diff']:+.1f} [{t['ci95'][0]:+.1f}, {t['ci95'][1]:+.1f}] | "
            f"{t['wilcoxon_p']:.3f} | {t['cliffs_delta']:+.2f} |"
        )
    out += [
        "",
        "## By chronotype / behavior cell",
        "",
        *_head(_COMPACT_COLS),
        *[_compact(n, a) for n, a in report["by_cell"].items()],
    ]
    rows = sweep_rows(report)
    if rows:
        out += [
            "",
            "## Alpha sweep (only BANDIT_ALPHA varies)",
            "",
            *_head(
                [
                    "alpha",
                    "regret H",
                    "regret L",
                    "regret diff [95% CI]",
                    "accept diff",
                    "drag diff (min)",
                    "regret diff, 0-5",
                    "regret diff, 40+",
                ]
            ),
        ]
        for r in rows:
            out.append(
                f"| {r['alpha']:g} | {r['regret_h']:.3f} | {r['regret_l']:.3f} | "
                f"{r['regret_diff']:+.3f} "
                f"[{r['regret_lo']:+.3f}, {r['regret_hi']:+.3f}] | "
                f"{r['accept_diff']:+.3f} | {r['drag_diff']:+.1f} | "
                f"{r['cold_regret_diff']:+.3f} | {r['warm_regret_diff']:+.3f} |"
            )
    return "\n".join(out) + "\n"
