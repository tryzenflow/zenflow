"""Paired metrics and statistics (numpy only; no scipy in this service).

Unit of analysis is the student: both policies run the same student, calendar
and tasks, so every comparison is LinUCB minus heuristic on the same student.
Placements of one student (and of one series) are correlated, so confidence
intervals come from a cluster bootstrap that resamples whole students.

Metrics, all per placement unless noted:

* ``regret``   - oracle utility minus the proposed slot's utility (primary, lower
  is better);
* ``accept``   - the proposal was kept, not dragged (higher is better);
* ``drag``     - minutes dragged, 0 when kept (lower is better);
* ``divergence`` - the two policies placed the same task at different starts;
* time-to-threshold - placements until a rolling-window acceptance rate first
  reaches the threshold (censored at the horizon).
"""

from __future__ import annotations

import math
import zlib
from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from .engine import HEURISTIC, SimConfig, StudentResult, linucb_label
from .rng import stream

BUCKET_EDGES = (0, 6, 11, 21, 41)  # lower bounds of 0-5 / 6-10 / 11-20 / 21-40 / 40+
BUCKET_LABELS = ("0-5", "6-10", "11-20", "21-40", "40+")
N_BOOT = 2000
TTT_WINDOW = 10
TTT_THRESHOLD = 0.6

Floats = NDArray[np.float64]


def bucket_index(obs_before: Floats) -> NDArray[np.int64]:
    """Cold-start bucket of each placement by prior interaction count."""
    return np.asarray(
        np.searchsorted(np.asarray(BUCKET_EDGES), obs_before, side="right") - 1,
        dtype=np.int64,
    )


# ---- statistics -------------------------------------------------------------


def wilcoxon_signed_rank(deltas: Floats) -> tuple[float, int, float, float]:
    """Paired Wilcoxon signed-rank on ``deltas``: ``(W+, n, z, two-sided p)``.

    Zero deltas are dropped, ties get average ranks, the normal approximation
    uses the tie-corrected variance and a continuity correction.
    """
    d = deltas[deltas != 0]
    n = int(d.size)
    if n == 0:
        return 0.0, 0, 0.0, 1.0
    absd = np.abs(d)
    order = np.argsort(absd, kind="stable")
    sorted_abs = absd[order]
    ranks_sorted = np.empty(n)
    tie_term = 0.0
    i = 0
    while i < n:
        j = i
        while j < n and sorted_abs[j] == sorted_abs[i]:
            j += 1
        ranks_sorted[i:j] = (i + 1 + j) / 2.0
        t = j - i
        tie_term += t**3 - t
        i = j
    ranks = np.empty(n)
    ranks[order] = ranks_sorted
    w_plus = float(ranks[d > 0].sum())
    mean = n * (n + 1) / 4.0
    var = n * (n + 1) * (2 * n + 1) / 24.0 - tie_term / 48.0
    if var <= 0:
        return w_plus, n, 0.0, 1.0
    diff = w_plus - mean
    z = (abs(diff) - 0.5) / math.sqrt(var) if diff != 0 else 0.0
    z = max(z, 0.0) * (1.0 if diff >= 0 else -1.0)
    p = math.erfc(abs(z) / math.sqrt(2.0))
    return w_plus, n, z, min(1.0, p)


def cliffs_delta(a: Floats, b: Floats) -> float:
    """P(a > b) - P(a < b) over all cross pairs, in [-1, 1]."""
    if a.size == 0 or b.size == 0:
        return 0.0
    gt = (a[:, None] > b[None, :]).sum()
    lt = (a[:, None] < b[None, :]).sum()
    return float(gt - lt) / float(a.size * b.size)


def cluster_bootstrap_ratio(
    num: Floats, den: Floats, rng: np.random.Generator, n_boot: int = N_BOOT
) -> tuple[float, float]:
    """95% CI of ``sum(num) / sum(den)`` resampling clusters with replacement."""
    k = num.size
    if k == 0:
        return 0.0, 0.0
    idx = rng.integers(0, k, size=(n_boot, k))
    est = num[idx].sum(axis=1) / np.maximum(den[idx].sum(axis=1), 1e-12)
    lo, hi = np.percentile(est, [2.5, 97.5])
    return float(lo), float(hi)


def _r(x: float) -> float:
    return round(float(x), 6)


# ---- paired rows ------------------------------------------------------------


@dataclass
class StudentRows:
    """One student's paired placements (both worlds, all scenarios)."""

    student_id: int
    cell: str
    scenario: NDArray[np.int64]
    bucket: NDArray[np.int64]
    h: dict[str, Floats]  # metric -> heuristic value per paired placement
    ln: dict[str, Floats]  # metric -> LinUCB value
    diverged: Floats  # 1.0 where the policies chose different starts
    start_gap_min: Floats  # |start difference| in minutes


def _key(log: dict[str, Floats]) -> NDArray[np.int64]:
    return np.asarray(log["task_id"] * 64 + log["member"], dtype=np.int64)


def paired_rows(
    results: list[StudentResult], scenarios: tuple[str, ...], label: str
) -> list[StudentRows]:
    out: list[StudentRows] = []
    for r in results:
        scen: list[NDArray[np.int64]] = []
        buckets: list[NDArray[np.int64]] = []
        cols_h: dict[str, list[Floats]] = {"regret": [], "accept": [], "drag": []}
        cols_l: dict[str, list[Floats]] = {"regret": [], "accept": [], "drag": []}
        div: list[Floats] = []
        gap: list[Floats] = []
        for si, name in enumerate(scenarios):
            h, ln = r.logs[name][HEURISTIC], r.logs[name][label]
            _, ih, il = np.intersect1d(_key(h), _key(ln), return_indices=True)
            scen.append(np.full(ih.size, si, dtype=np.int64))
            buckets.append(bucket_index(ln["obs_before"][il]))
            for m, src in (
                ("regret", "regret"),
                ("accept", "accepted"),
                ("drag", "drag"),
            ):
                cols_h[m].append(h[src][ih])
                cols_l[m].append(ln[src][il])
            delta = np.abs(h["start"][ih] - ln["start"][il]) / 60_000.0
            gap.append(delta)
            div.append((delta > 0).astype(np.float64))
        out.append(
            StudentRows(
                r.student_id,
                f"{r.chronotype}/{r.behavior}",
                np.concatenate(scen),
                np.concatenate(buckets),
                {m: np.concatenate(v) for m, v in cols_h.items()},
                {m: np.concatenate(v) for m, v in cols_l.items()},
                np.concatenate(div),
                np.concatenate(gap),
            )
        )
    return out


def _rng(seed: int, *labels: str) -> np.random.Generator:
    return stream(seed, "bootstrap", *(zlib.crc32(s.encode()) for s in labels))


def aggregate(
    rows: list[StudentRows],
    seed: int,
    tag: str,
    scenario: int | None = None,
    bucket: int | None = None,
    cell: str | None = None,
    n_boot: int = N_BOOT,
) -> dict[str, object]:
    """Paired LinUCB-vs-heuristic summary for a slice of the placements."""
    parts: list[tuple[int, dict[str, tuple[float, float]], float, float]] = []
    for s in rows:
        if cell is not None and s.cell != cell:
            continue
        mask = np.ones(s.scenario.size, dtype=bool)
        if scenario is not None:
            mask &= s.scenario == scenario
        if bucket is not None:
            mask &= s.bucket == bucket
        n = int(mask.sum())
        if n == 0:
            continue
        sums = {
            m: (float(s.h[m][mask].sum()), float(s.ln[m][mask].sum()))
            for m in ("regret", "accept", "drag")
        }
        parts.append(
            (n, sums, float(s.diverged[mask].sum()), float(s.start_gap_min[mask].sum()))
        )
    out: dict[str, object] = {
        "n_students": len(parts),
        "n_placements": int(sum(p[0] for p in parts)),
    }
    if not parts:
        return out
    n_arr = np.array([p[0] for p in parts], dtype=np.float64)
    for m in ("regret", "accept", "drag"):
        h_sum = np.array([p[1][m][0] for p in parts])
        l_sum = np.array([p[1][m][1] for p in parts])
        rng = _rng(seed, tag, m)
        lo, hi = cluster_bootstrap_ratio(l_sum - h_sum, n_arr, rng, n_boot)
        per_h, per_l = h_sum / n_arr, l_sum / n_arr
        _, _, z, p = wilcoxon_signed_rank(per_l - per_h)
        out[m] = {
            "heuristic": _r(h_sum.sum() / n_arr.sum()),
            "linucb": _r(l_sum.sum() / n_arr.sum()),
            "diff": _r((l_sum.sum() - h_sum.sum()) / n_arr.sum()),
            "ci95": [_r(lo), _r(hi)],
            "wilcoxon_z": _r(z),
            "wilcoxon_p": _r(p),
            "cliffs_delta": _r(cliffs_delta(per_l, per_h)),
        }
    div = np.array([p[2] for p in parts])
    gap = np.array([p[3] for p in parts])
    rng = _rng(seed, tag, "divergence")
    lo, hi = cluster_bootstrap_ratio(div, n_arr, rng, n_boot)
    out["divergence"] = {
        "rate": _r(div.sum() / n_arr.sum()),
        "ci95": [_r(lo), _r(hi)],
        "mean_start_gap_min": _r(gap.sum() / n_arr.sum()),
    }
    return out


# ---- time to threshold --------------------------------------------------------


def time_to_threshold(accepted: Floats) -> tuple[int, bool]:
    """Placements until the rolling acceptance first reaches the threshold;
    ``(horizon, False)`` when it never does (censored)."""
    n = accepted.size
    if n < TTT_WINDOW:
        return n, False
    roll = np.convolve(accepted, np.ones(TTT_WINDOW) / TTT_WINDOW, mode="valid")
    hit = np.flatnonzero(roll >= TTT_THRESHOLD - 1e-12)
    if hit.size == 0:
        return n, False
    return int(hit[0]) + TTT_WINDOW, True


def ttt_summary(
    results: list[StudentResult],
    scenario: str,
    label: str,
    seed: int,
    n_boot: int = N_BOOT,
) -> dict[str, object]:
    th: list[int] = []
    tl: list[int] = []
    rh: list[bool] = []
    rl: list[bool] = []
    for r in results:
        h = r.logs[scenario][HEURISTIC]["accepted"]
        ln = r.logs[scenario][label]["accepted"]
        t1, r1 = time_to_threshold(h)
        t2, r2 = time_to_threshold(ln)
        th.append(t1)
        tl.append(t2)
        rh.append(r1)
        rl.append(r2)
    ah, al = np.array(th, dtype=np.float64), np.array(tl, dtype=np.float64)
    diff = al - ah
    rng = _rng(seed, "ttt", scenario, label)
    lo, hi = cluster_bootstrap_ratio(diff, np.ones_like(diff), rng, n_boot)
    _, _, z, p = wilcoxon_signed_rank(diff)
    return {
        "window": TTT_WINDOW,
        "threshold": TTT_THRESHOLD,
        "n_students": len(th),
        "reached_heuristic": _r(float(np.mean(rh))),
        "reached_linucb": _r(float(np.mean(rl))),
        "median_heuristic": _r(float(np.median(ah))),
        "median_linucb": _r(float(np.median(al))),
        "mean_diff": _r(float(diff.mean())),
        "ci95": [_r(lo), _r(hi)],
        "wilcoxon_p": _r(p),
        "cliffs_delta": _r(cliffs_delta(al, ah)),
    }


# ---- report -----------------------------------------------------------------------


def primary_alpha(cfg: SimConfig) -> float:
    return 0.15 if 0.15 in cfg.alphas else cfg.alphas[0]


def build_report(
    cfg: SimConfig, results: list[StudentResult], n_boot: int = N_BOOT
) -> dict[str, object]:
    results = sorted(results, key=lambda r: r.student_id)
    scenarios = cfg.scenarios
    alpha = primary_alpha(cfg)
    label = linucb_label(alpha)
    rows = paired_rows(results, scenarios, label)
    cells = sorted({s.cell for s in rows})

    report: dict[str, object] = {
        "config": {
            "seed": cfg.seed,
            "students": cfg.n_students,
            "events_per_student": cfg.n_events,
            "alphas": list(cfg.alphas),
            "ridge": cfg.ridge,
            "scenarios": list(scenarios),
            "balanced_archetypes": cfg.balanced,
            "primary_alpha": alpha,
        },
        "convention": "diff = LinUCB - heuristic; regret and drag: lower is better",
        "overall": aggregate(rows, cfg.seed, "overall", n_boot=n_boot),
        "by_scenario": {
            name: aggregate(rows, cfg.seed, f"scn-{name}", scenario=i, n_boot=n_boot)
            for i, name in enumerate(scenarios)
        },
        "by_bucket": {
            BUCKET_LABELS[b]: aggregate(
                rows, cfg.seed, f"bkt-{b}", bucket=b, n_boot=n_boot
            )
            for b in range(len(BUCKET_LABELS))
        },
        "by_cell": {
            c: aggregate(rows, cfg.seed, f"cell-{c}", cell=c, n_boot=n_boot)
            for c in cells
        },
        "time_to_threshold": {
            name: ttt_summary(results, name, label, cfg.seed, n_boot)
            for name in scenarios
        },
    }
    if len(cfg.alphas) > 1:
        sweep: list[dict[str, object]] = []
        for a in cfg.alphas:
            lab = linucb_label(a)
            r_a = paired_rows(results, scenarios, lab)
            sweep.append(
                {
                    "alpha": a,
                    "overall": aggregate(r_a, cfg.seed, f"sw-{a}", n_boot=n_boot),
                    "cold_0_5": aggregate(
                        r_a, cfg.seed, f"sw-{a}-c", bucket=0, n_boot=n_boot
                    ),
                    "warm_40_plus": aggregate(
                        r_a, cfg.seed, f"sw-{a}-w", bucket=4, n_boot=n_boot
                    ),
                }
            )
        report["alpha_sweep"] = sweep
    return report
