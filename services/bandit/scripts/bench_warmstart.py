"""Warm-start prior study (prototype, issue #60): heuristic vs LinUCB vs warm LinUCB.

uv run python -m scripts.bench_warmstart --seeds 1-3 --students 1000 --workers 16 \
    --priors pref:2 pref:5 pref:10 --out-dir sim_out/warmstart

One simulation pass per seed runs the heuristic, the cold LinUCB and one warm LinUCB
world per ``mode:n0`` (all on the same students / calendars / tasks / reaction
draws). Each finished student is reduced to per scenario x cold-start-bucket sums for
every policy over the *paired* placements, plus time-to-threshold, so memory stays
small. Output: ``summary.json`` and ``summary.md`` (pooled across seeds: sum over
placements / placements; ttt = mean over student x scenario x seed).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import zlib
from collections.abc import Sequence
from concurrent.futures import ProcessPoolExecutor
from dataclasses import replace
from functools import reduce
from pathlib import Path
from typing import cast

import numpy as np
from numpy.typing import NDArray

from src.simulation.engine import HEURISTIC, SimConfig, linucb_label
from src.simulation.metrics import (
    BUCKET_LABELS,
    N_BOOT,
    _key,
    bucket_index,
    time_to_threshold,
)
from src.simulation.prior import PriorSpec
from src.simulation.rng import stream
from src.simulation.run import _run_one

Floats = NDArray[np.float64]
METRICS = ("regret", "accept", "drag")
POLICIES = ("heuristic", "cold")  # then one per warm spec


def parse_seeds(text: str) -> list[int]:
    out: list[int] = []
    for part in text.split(","):
        lo, _, hi = part.partition("-")
        out.extend(range(int(lo), int(hi or lo) + 1))
    return out


def _ttt(
    logs: dict[str, dict[str, dict[str, Floats]]], label: str, scn: tuple[str, ...]
) -> Floats:
    return np.array(
        [time_to_threshold(logs[s][label]["accepted"])[0] for s in scn],
        dtype=np.float64,
    )


def student_record(
    cfg: SimConfig, student_id: int
) -> tuple[str, dict[str, Floats], dict[str, Floats]]:
    """``(cell, sums[policy] (B, 4), ttt[policy] (S,))`` for one student.

    ``sums`` columns: placements, regret, accept, drag over the placements shared by
    *every* policy (heuristic, cold and all warm priors) in each scenario, so every
    policy difference is over the same proposals even when a policy leaves a later
    task infeasible.
    """
    res = _run_one((cfg, student_id))
    specs = [PriorSpec(m, n) for m, n in cfg.priors]
    labels = {"cold": linucb_label(0.15)}
    labels.update({s.tag: linucb_label(0.15, s) for s in specs})
    n_b = len(BUCKET_LABELS)
    sums = {p: np.zeros((n_b, 4)) for p in ("heuristic", *labels)}
    ttt: dict[str, Floats] = {}
    for scn in cfg.scenarios:
        logs = {"heuristic": res.logs[scn][HEURISTIC]}
        logs.update({n: res.logs[scn][lab] for n, lab in labels.items()})
        # one placement set for every policy, so all differences are paired
        common = reduce(np.intersect1d, (_key(lg) for lg in logs.values()))
        # buckets follow the cold arm's own observation count, as in paired_rows
        cold = logs["cold"]
        bucket = bucket_index(
            cold["obs_before"][np.isin(_key(cold), common, assume_unique=True)]
        )
        for pol, lg in logs.items():
            keep = np.isin(_key(lg), common, assume_unique=True)
            g = sums[pol]
            g[:, 0] += np.bincount(bucket, minlength=n_b)
            for j, (_m, src) in enumerate(
                (("regret", "regret"), ("accept", "accepted"), ("drag", "drag")),
                start=1,
            ):
                g[:, j] += np.bincount(bucket, weights=lg[src][keep], minlength=n_b)
    for name, label in labels.items():
        ttt[name] = np.array(
            [
                time_to_threshold(res.logs[s][label]["accepted"])[0]
                for s in cfg.scenarios
            ],
            dtype=np.float64,
        )
    ttt["heuristic"] = np.array(
        [
            time_to_threshold(res.logs[s][HEURISTIC]["accepted"])[0]
            for s in cfg.scenarios
        ],
        dtype=np.float64,
    )
    return f"{res.chronotype}/{res.behavior}", sums, ttt


def _job(
    args: tuple[SimConfig, int],
) -> tuple[str, dict[str, Floats], dict[str, Floats]]:
    return student_record(*args)


def main(argv: Sequence[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m scripts.bench_warmstart")
    ap.add_argument("--seeds", default="1")
    ap.add_argument("--students", type=int, default=300)
    ap.add_argument("--events", type=int, default=60)
    ap.add_argument("--workers", type=int, default=min(16, os.cpu_count() or 1))
    ap.add_argument("--priors", nargs="+", default=["pref:2", "pref:5", "pref:10"])
    ap.add_argument("--n-boot", type=int, default=N_BOOT)
    ap.add_argument("--out-dir", type=Path, default=Path("sim_out") / "warmstart")
    a = ap.parse_args(argv)
    priors = tuple((p.split(":")[0], float(p.split(":")[1])) for p in a.priors)
    names = [PriorSpec(m, n).tag for m, n in priors]
    pol_names = ["heuristic", "cold", *names]

    # one record per student (all seeds pooled): cell, sums[policy] (B,4), ttt[policy]
    cells: list[str] = []
    recs: list[dict[str, Floats]] = []
    ttt_recs: list[dict[str, float]] = []
    t0 = time.perf_counter()
    with ProcessPoolExecutor(max_workers=a.workers) as pool:
        for seed in parse_seeds(a.seeds):
            cfg = replace(
                SimConfig(seed=seed, n_students=a.students, n_events=a.events),
                priors=priors,
            )
            jobs = [(cfg, sid) for sid in range(cfg.n_students)]
            for cell, s, t in pool.map(_job, jobs, chunksize=2):
                cells.append(cell)
                recs.append(s)
                ttt_recs.append({p: float(v.mean()) for p, v in t.items()})
            print(f"seed {seed} done {time.perf_counter() - t0:.0f}s", file=sys.stderr)

    out = summarize(np.array(cells), recs, ttt_recs, pol_names, a.n_boot)
    a.out_dir.mkdir(parents=True, exist_ok=True)
    (a.out_dir / "summary.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
    md = render(out, pol_names)
    (a.out_dir / "summary.md").write_text(md, encoding="utf-8")
    print(md)
    print(f"{time.perf_counter() - t0:.0f}s", file=sys.stderr)
    return 0


_CHUNK_ELEMS = 4_000_000
# metric -> (numerator column, denominator bucket columns, numerator buckets)
_BUCKETS = {"all": slice(None), "0_10": slice(0, 2), "40": slice(4, 5)}
_SPECS = {
    "regret": (1, "all"),
    "accept": (2, "all"),
    "drag": (3, "all"),
    "regret0_10": (1, "0_10"),
    "regret40": (1, "40"),
    "accept40": (2, "40"),
}


def pairs(pols: list[str]) -> list[tuple[str, str]]:
    """``(a, b)`` differences ``a - b``: cold vs heuristic, each warm vs both."""
    out = [("cold", "heuristic")]
    for w in pols[2:]:
        out += [(w, "heuristic"), (w, "cold")]
    return out


def _student_terms(
    recs: list[dict[str, Floats]], ttt: list[dict[str, float]], pol: str
) -> dict[str, tuple[Floats, Floats]]:
    """Per-student ``(numerator, denominator)`` of every metric for one policy."""
    g = np.stack([r[pol] for r in recs])  # (N, B, 4)
    terms: dict[str, tuple[Floats, Floats]] = {}
    for m, (col, bk) in _SPECS.items():
        sl = _BUCKETS[bk]
        terms[m] = (g[:, sl, col].sum(axis=1), g[:, sl, 0].sum(axis=1))
    t = np.array([x[pol] for x in ttt])
    terms["ttt"] = (t, np.ones_like(t))
    return terms


def summarize(
    cells: NDArray[np.str_],
    recs: list[dict[str, Floats]],
    ttt: list[dict[str, float]],
    pols: list[str],
    n_boot: int,
) -> dict[str, dict[str, dict[str, object]]]:
    """Point estimates + 95% student-level cluster-bootstrap CIs, overall and per cell.

    Every policy (and every paired difference) is resampled with the *same* student
    indices, so the difference CIs respect that the systems share students.
    """
    terms = {p: _student_terms(recs, ttt, p) for p in pols}
    metrics = [*_SPECS, "ttt"]
    out: dict[str, dict[str, dict[str, object]]] = {}
    groups = {"ALL": np.ones(cells.size, dtype=bool)}
    groups.update({c: cells == c for c in sorted(set(cells.tolist()))})
    for grp, keep in groups.items():
        rng = stream(0, "bootstrap", zlib.crc32(f"warmstart|{grp}".encode()))
        sub = {
            p: {m: (n[keep], d[keep]) for m, (n, d) in terms[p].items()} for p in pols
        }
        k = int(keep.sum())
        point = {
            p: {m: float(n.sum() / d.sum()) for m, (n, d) in sub[p].items()}
            for p in pols
        }
        est: dict[str, dict[str, list[Floats]]] = {
            p: {m: [] for m in metrics} for p in pols
        }
        done, chunk = 0, max(1, _CHUNK_ELEMS // k)
        while done < n_boot:
            b = min(chunk, n_boot - done)
            idx = rng.integers(0, k, size=(b, k))
            for p in pols:
                for m, (n, d) in sub[p].items():
                    est[p][m].append(n[idx].sum(axis=1) / d[idx].sum(axis=1))
            done += b
        boots = {p: {m: np.concatenate(v) for m, v in est[p].items()} for p in pols}

        def ci(x: Floats) -> list[float]:
            lo, hi = np.percentile(x, [2.5, 97.5])
            return [float(lo), float(hi)]

        out[grp] = {}
        for p in pols:
            row: dict[str, object] = {"n": float(sub[p]["regret"][1].sum())}
            for m in metrics:
                row[m] = point[p][m]
                row[f"{m}_ci"] = ci(boots[p][m])
            out[grp][p] = row
        for a_, b_ in pairs(pols):
            row = {}
            for m in metrics:
                row[m] = point[a_][m] - point[b_][m]
                diff = boots[a_][m] - boots[b_][m]
                row[f"{m}_ci"] = ci(diff)
                row[f"{m}_sig"] = bool(row[f"{m}_ci"][0] > 0 or row[f"{m}_ci"][1] < 0)  # type: ignore[index]
            out[grp][f"{a_}-{b_}"] = row
    return out


def render(out: dict[str, dict[str, dict[str, object]]], pols: list[str]) -> str:
    lines: list[str] = []
    diffs = [f"{a}-{b}" for a, b in pairs(pols)]
    for metric in ("regret", "accept", "drag", "ttt", "regret0_10", "regret40"):
        lines.append(f"\n### {metric}\n")
        cols = [*pols, *diffs]
        lines.append("| group | " + " | ".join(cols) + " |")
        lines.append("|---|" + "---|" * len(cols))
        for grp in ["ALL", *sorted(g for g in out if g != "ALL")]:
            cells = []
            for c in cols:
                r = out[grp][c]
                lo, hi = cast("list[float]", r[f"{metric}_ci"])
                star = "*" if r.get(f"{metric}_sig") else ""
                cells.append(
                    f"{cast('float', r[metric]):.3f} [{lo:.3f}, {hi:.3f}]{star}"
                )
            lines.append(f"| {grp} | " + " | ".join(cells) + " |")
    lines.append("\n`*` = paired difference whose 95% CI excludes 0.\n")
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    raise SystemExit(main())
