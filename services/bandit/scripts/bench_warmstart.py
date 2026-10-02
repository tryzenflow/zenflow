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
from collections import defaultdict
from collections.abc import Sequence
from concurrent.futures import ProcessPoolExecutor
from dataclasses import replace
from pathlib import Path

import numpy as np
from numpy.typing import NDArray

from src.simulation.engine import HEURISTIC, SimConfig, linucb_label
from src.simulation.metrics import BUCKET_LABELS, paired_rows, time_to_threshold
from src.simulation.prior import PriorSpec
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

    ``sums`` columns: placements, regret, accept, drag over the placements the
    policy shares with the heuristic; the heuristic row is that same paired set of
    the *cold* pairing (the placements are identical for every pairing unless a
    policy skips an infeasible task, which the key intersection handles).
    """
    res = _run_one((cfg, student_id))
    specs = [PriorSpec(m, n) for m, n in cfg.priors]
    labels = {"cold": linucb_label(0.15)}
    labels.update({s.tag: linucb_label(0.15, s) for s in specs})
    n_b = len(BUCKET_LABELS)
    sums: dict[str, Floats] = {}
    ttt: dict[str, Floats] = {}
    for name, label in labels.items():
        (rows,) = paired_rows([res], cfg.scenarios, label)
        for pol, side in (
            ("heuristic" if name == "cold" else None, rows.h),
            (name, rows.ln),
        ):
            if pol is None:
                continue
            g = np.zeros((n_b, 4))
            g[:, 0] = np.bincount(rows.bucket, minlength=n_b)
            for j, m in enumerate(METRICS, start=1):
                g[:, j] = np.bincount(rows.bucket, weights=side[m], minlength=n_b)
            sums[pol] = g
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
    ap.add_argument("--out-dir", type=Path, default=Path("sim_out") / "warmstart")
    a = ap.parse_args(argv)
    priors = tuple((p.split(":")[0], float(p.split(":")[1])) for p in a.priors)
    names = [PriorSpec(m, n).tag for m, n in priors]
    pol_names = ["heuristic", "cold", *names]

    # acc[group][policy] -> (B,4) sums and ttt lists; group = "ALL" or a cell
    sums: dict[str, dict[str, Floats]] = defaultdict(dict)
    ttts: dict[str, dict[str, list[Floats]]] = defaultdict(lambda: defaultdict(list))
    t0 = time.perf_counter()
    with ProcessPoolExecutor(max_workers=a.workers) as pool:
        for seed in parse_seeds(a.seeds):
            cfg = replace(
                SimConfig(seed=seed, n_students=a.students, n_events=a.events),
                priors=priors,
            )
            jobs = [(cfg, sid) for sid in range(cfg.n_students)]
            for cell, s, t in pool.map(_job, jobs, chunksize=2):
                for grp in ("ALL", cell):
                    for pol, g in s.items():
                        sums[grp][pol] = sums[grp].get(pol, 0.0) + g
                    for pol, v in t.items():
                        ttts[grp][pol].append(v)
            print(f"seed {seed} done {time.perf_counter() - t0:.0f}s", file=sys.stderr)

    out: dict[str, dict[str, dict[str, float]]] = {}
    for grp in sums:
        out[grp] = {}
        for pol in pol_names:
            g = sums[grp][pol]
            n = g[:, 0].sum()
            row = {m: float(g[:, j].sum() / n) for j, m in enumerate(METRICS, start=1)}
            row["ttt"] = float(np.concatenate(ttts[grp][pol]).mean())
            row["n"] = float(n)
            late = g[4]  # 40+ bucket
            row["regret40"] = float(late[1] / late[0])
            row["accept40"] = float(late[2] / late[0])
            early = g[0] + g[1]  # 0-10
            row["regret0_10"] = float(early[1] / early[0])
            out[grp][pol] = row
    a.out_dir.mkdir(parents=True, exist_ok=True)
    (a.out_dir / "summary.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
    md = render(out, pol_names)
    (a.out_dir / "summary.md").write_text(md, encoding="utf-8")
    print(md)
    print(f"{time.perf_counter() - t0:.0f}s", file=sys.stderr)
    return 0


def render(out: dict[str, dict[str, dict[str, float]]], pols: list[str]) -> str:
    lines: list[str] = []
    for metric in ("regret", "accept", "drag", "ttt", "regret0_10", "regret40"):
        lines.append(f"\n### {metric}\n")
        lines.append("| group | " + " | ".join(pols) + " |")
        lines.append("|---|" + "---|" * len(pols))
        for grp in ["ALL", *sorted(g for g in out if g != "ALL")]:
            vals = [out[grp][p][metric] for p in pols]
            lines.append(f"| {grp} | " + " | ".join(f"{v:.3f}" for v in vals) + " |")
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    raise SystemExit(main())
