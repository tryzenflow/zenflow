"""Multi-seed driver: many seeds sequentially, then one pooled summary.

python -m scripts.run_seeds --seeds 1-30 --students 2000 --workers 8 \
    --out-dir sim_out/multi

Each seed runs the paired simulation through the same machinery as
``src.simulation.run`` (one process pool, ``run_student`` per student) but
*streams*: every finished student is reduced at once to a tiny record (per
scenario x cold-start bucket sums of the LinUCB-minus-heuristic differences, plus
time-to-threshold), so a seed never holds more than a few students' placement
logs in memory. The records are cached per seed under ``<out-dir>/seed-N/``
keyed like the report cache (config + simulator source), so an interrupted run
resumes at the first unfinished seed and a source edit invalidates the lot.

The pooled summary (``pooled.json`` + ``pooled.md``) has, for overall, each
chronotype x behavior cell, each cold-start bucket and each scenario: the mean
across seeds of the per-seed LinUCB-minus-heuristic difference in regret,
acceptance, drag and time-to-threshold, the across-seed sd and range, the share
of seeds where LinUCB is better, and a student-level cluster bootstrap CI of the
pooled difference (resampling all seeds' students together, in chunks to bound
memory). Time-to-threshold is per student x scenario, so it has no bucket rows.
Everything is a pure function of the config and the source.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
import zlib
from collections.abc import Sequence
from concurrent.futures import Executor, ProcessPoolExecutor
from dataclasses import dataclass, replace
from pathlib import Path

import numpy as np
from numpy.typing import NDArray

from src.simulation import cache
from src.simulation.engine import HEURISTIC, SimConfig, StudentResult, linucb_label
from src.simulation.metrics import (
    BUCKET_LABELS,
    N_BOOT,
    paired_rows,
    primary_alpha,
    time_to_threshold,
)
from src.simulation.rng import stream
from src.simulation.run import _run_one
from src.simulation.world import SCENARIO_BY_NAME

_SCHEMA = 1  # bump when the per-seed record layout changes
DEFAULT_OUT_DIR = Path("sim_out") / "multi"
METRICS = ("regret", "accept", "drag", "ttt")
# LinUCB is better when the difference is negative (regret, drag, ttt) or positive
_BETTER_SIGN = {"regret": -1.0, "accept": 1.0, "drag": -1.0, "ttt": -1.0}
_CHUNK_ELEMS = 4_000_000  # bootstrap gathers at most this many indices at a time

Floats = NDArray[np.float64]


# ---- per-seed record ----------------------------------------------------------


@dataclass
class SeedRecord:
    """Everything the pooling needs from one seed, one row per student."""

    seed: int
    cells: NDArray[np.str_]  # (N,) "chronotype/behavior"
    grid: Floats  # (N, S, B, 4): placements, regret/accept/drag diff sums
    ttt: Floats  # (N, S): time-to-threshold diff (LinUCB - heuristic)
    scenarios: tuple[str, ...]


def summarize_student(
    r: StudentResult, scenarios: tuple[str, ...], label: str
) -> tuple[Floats, Floats]:
    """One student's ``(S, B, 4)`` difference sums and ``(S,)`` ttt differences."""
    n_s, n_b = len(scenarios), len(BUCKET_LABELS)
    (rows,) = paired_rows([r], scenarios, label)
    flat = rows.scenario * n_b + rows.bucket
    grid = np.zeros((n_s * n_b, 4))
    grid[:, 0] = np.bincount(flat, minlength=n_s * n_b)
    for j, m in enumerate(("regret", "accept", "drag"), start=1):
        grid[:, j] = np.bincount(
            flat, weights=rows.ln[m] - rows.h[m], minlength=n_s * n_b
        )
    ttt = np.array(
        [
            time_to_threshold(r.logs[s][label]["accepted"])[0]
            - time_to_threshold(r.logs[s][HEURISTIC]["accepted"])[0]
            for s in scenarios
        ],
        dtype=np.float64,
    )
    return grid.reshape(n_s, n_b, 4), ttt


def run_seed(
    cfg: SimConfig, pool: Executor | None, progress_every: int = 250
) -> SeedRecord:
    """Stream one seed's students through ``run_student`` into a record."""
    label = linucb_label(primary_alpha(cfg))
    jobs = [(cfg, sid) for sid in range(cfg.n_students)]
    results = map(_run_one, jobs) if pool is None else pool.map(_run_one, jobs)
    cells: list[str] = []
    grids: list[Floats] = []
    ttts: list[Floats] = []
    for i, res in enumerate(results, start=1):
        g, t = summarize_student(res, cfg.scenarios, label)
        cells.append(f"{res.chronotype}/{res.behavior}")
        grids.append(g)
        ttts.append(t)
        if i % progress_every == 0:
            print(f"  seed {cfg.seed}: {i}/{cfg.n_students}", file=sys.stderr)
    return SeedRecord(
        cfg.seed,
        np.array(cells),
        np.stack(grids),
        np.stack(ttts),
        cfg.scenarios,
    )


def _record_path(out_dir: Path, seed: int) -> Path:
    return out_dir / f"seed-{seed}" / "records.npz"


def _store(rec: SeedRecord, key: str, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp.npz")
    np.savez_compressed(
        tmp,
        key=np.array(key),
        cells=rec.cells,
        grid=rec.grid,
        ttt=rec.ttt,
        scenarios=np.array(rec.scenarios),
    )
    os.replace(tmp, path)  # atomic: an interrupted write never looks complete


def _load(seed: int, key: str, path: Path) -> SeedRecord | None:
    if not path.exists():
        return None
    try:
        with np.load(path) as z:
            if str(z["key"]) != key:
                return None
            return SeedRecord(
                seed,
                z["cells"],
                z["grid"],
                z["ttt"],
                tuple(str(s) for s in z["scenarios"]),
            )
    except (OSError, ValueError, KeyError):
        return None


def get_seed(
    cfg: SimConfig, out_dir: Path, pool: Executor | None, use_cache: bool = True
) -> tuple[SeedRecord, bool]:
    key = f"{cache.cache_key(cfg)}|{_SCHEMA}"
    path = _record_path(out_dir, cfg.seed)
    if use_cache and (hit := _load(cfg.seed, key, path)) is not None:
        return hit, True
    rec = run_seed(cfg, pool)
    if use_cache:
        _store(rec, key, path)
    return rec, False


# ---- pooling --------------------------------------------------------------------


@dataclass(frozen=True)
class Slice:
    name: str
    scen: tuple[int, ...] | None = None
    bucket: int | None = None
    cell: str | None = None

    @property
    def has_ttt(self) -> bool:
        return self.bucket is None


def slice_sums(rec: SeedRecord, sl: Slice) -> tuple[Floats, Floats, Floats, Floats]:
    """Per-student ``(placements, diff sums (N, 3), ttt diff sum, ttt count)``."""
    n_students, n_s, n_b, _ = rec.grid.shape
    si = list(range(n_s)) if sl.scen is None else list(sl.scen)
    bi = list(range(n_b)) if sl.bucket is None else [sl.bucket]
    keep = np.ones(n_students, dtype=bool) if sl.cell is None else rec.cells == sl.cell
    g = rec.grid[np.ix_(keep, si, bi)].sum(axis=(1, 2))
    tt = rec.ttt[np.ix_(keep, si)]
    return g[:, 0], g[:, 1:], tt.sum(axis=1), np.full(tt.shape[0], float(len(si)))


def _ratio(num: Floats, den: Floats) -> float:
    d = float(den.sum())
    return math.nan if d <= 0 else float(num.sum()) / d


def bootstrap_ci(
    num: Floats, den: Floats, rng: np.random.Generator, n_boot: int
) -> tuple[float, float]:
    """95% CI of ``sum(num) / sum(den)`` resampling clusters, in memory-bounded
    chunks (the full ``n_boot x clusters`` index matrix is never built)."""
    k = num.size
    if k == 0 or den.sum() <= 0:
        return math.nan, math.nan
    chunk = max(1, _CHUNK_ELEMS // k)
    est: list[Floats] = []
    done = 0
    while done < n_boot:
        b = min(chunk, n_boot - done)
        idx = rng.integers(0, k, size=(b, k))
        est.append(num[idx].sum(axis=1) / np.maximum(den[idx].sum(axis=1), 1e-12))
        done += b
    lo, hi = np.percentile(np.concatenate(est), [2.5, 97.5])
    return float(lo), float(hi)


def _r(x: float) -> float | None:
    return None if math.isnan(x) else round(float(x), 6)


def pool_slice(
    records: list[SeedRecord], sl: Slice, n_boot: int = N_BOOT
) -> dict[str, object]:
    """Across-seed and pooled student-level statistics of one slice."""
    parts = [slice_sums(rec, sl) for rec in records]
    out: dict[str, object] = {
        "n_seeds": len(records),
        "n_students_per_seed": float(np.mean([p[0].size for p in parts])),
    }
    for j, m in enumerate(METRICS):
        if m == "ttt" and not sl.has_ttt:
            continue
        if m == "ttt":
            nums = [p[2] for p in parts]
            dens = [p[3] for p in parts]
        else:
            nums = [p[1][:, j] for p in parts]
            dens = [p[0] for p in parts]
        per_seed = np.array([_ratio(n, d) for n, d in zip(nums, dens, strict=True)])
        ok = per_seed[~np.isnan(per_seed)]
        if ok.size == 0:
            continue
        num_all, den_all = np.concatenate(nums), np.concatenate(dens)
        seed_rng = stream(0, "bootstrap", zlib.crc32(f"pool|{sl.name}|{m}".encode()))
        lo, hi = bootstrap_ci(num_all, den_all, seed_rng, n_boot)
        out[m] = {
            "mean_diff": _r(float(ok.mean())),
            "sd": _r(float(ok.std(ddof=1)) if ok.size > 1 else 0.0),
            "min": _r(float(ok.min())),
            "max": _r(float(ok.max())),
            "share_seeds_linucb_better": _r(float(np.mean(_BETTER_SIGN[m] * ok > 0))),
            "pooled_diff": _r(_ratio(num_all, den_all)),
            "pooled_ci95": [_r(lo), _r(hi)],
            "per_seed": [_r(float(v)) for v in per_seed],
        }
    return out


def pool(records: list[SeedRecord], n_boot: int = N_BOOT) -> dict[str, object]:
    """The pooled report over all seeds' records (ordered by seed)."""
    records = sorted(records, key=lambda r: r.seed)
    scenarios = records[0].scenarios
    cells = sorted({str(c) for rec in records for c in rec.cells})
    return {
        "convention": (
            "diff = LinUCB - heuristic per seed; regret, drag and time-to-threshold: "
            "lower is better, accept: higher is better. CI = student-level cluster "
            "bootstrap over all seeds' students pooled."
        ),
        "seeds": [r.seed for r in records],
        "students_per_seed": int(records[0].cells.size),
        "n_boot": n_boot,
        "overall": pool_slice(records, Slice("overall"), n_boot),
        "by_cell": {
            c: pool_slice(records, Slice(f"cell-{c}", cell=c), n_boot) for c in cells
        },
        "by_bucket": {
            BUCKET_LABELS[b]: pool_slice(records, Slice(f"bkt-{b}", bucket=b), n_boot)
            for b in range(len(BUCKET_LABELS))
        },
        "by_scenario": {
            name: pool_slice(records, Slice(f"scn-{name}", scen=(i,)), n_boot)
            for i, name in enumerate(scenarios)
        },
    }


# ---- rendering ----------------------------------------------------------------


def _f(x: object, nd: int = 4) -> str:
    return "-" if x is None else f"{float(x):.{nd}f}"  # type: ignore[arg-type]


def _row(label: str, st: dict[str, object]) -> str:
    ci = st["pooled_ci95"]
    assert isinstance(ci, list)
    return (
        f"| {label} | {_f(st['mean_diff'])} | {_f(st['sd'])} | "
        f"{_f(st['min'])} .. {_f(st['max'])} | "
        f"{float(st['share_seeds_linucb_better']) * 100:.0f}% | "  # type: ignore[arg-type]
        f"{_f(st['pooled_diff'])} [{_f(ci[0])}, {_f(ci[1])}] |"
    )


_HEAD = (
    "| slice | mean diff | sd | range | seeds LinUCB better | pooled diff [95% CI] |\n"
    "| --- | ---: | ---: | --- | ---: | --- |"
)


def render_markdown(rep: dict[str, object]) -> str:
    seeds = rep["seeds"]
    assert isinstance(seeds, list)
    lines = [
        "# Multi-seed pooled summary",
        "",
        f"{len(seeds)} seeds ({seeds[0]}..{seeds[-1]}), "
        f"{rep['students_per_seed']} students per seed.",
        "",
        str(rep["convention"]),
        "",
    ]
    sections = (
        ("Overall", "overall"),
        ("By chronotype x behavior", "by_cell"),
        ("By cold-start bucket", "by_bucket"),
        ("By scenario", "by_scenario"),
    )
    for title, key in sections:
        block = rep[key]
        assert isinstance(block, dict)
        groups: dict[str, dict[str, object]] = (
            {"all": block} if key == "overall" else block
        )
        lines += [f"## {title}", ""]
        for m in METRICS:
            rows = [
                _row(name, g[m])  # type: ignore[arg-type]
                for name, g in groups.items()
                if m in g
            ]
            if not rows:
                continue
            lines += [f"### {m}", "", _HEAD, *rows, ""]
    return "\n".join(lines).rstrip() + "\n"


def write_pooled(rep: dict[str, object], out_dir: Path) -> tuple[Path, Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    js, md = out_dir / "pooled.json", out_dir / "pooled.md"
    js.write_text(json.dumps(rep, indent=2) + "\n", encoding="utf-8", newline="\n")
    md.write_text(render_markdown(rep), encoding="utf-8", newline="\n")
    return md, js


# ---- CLI --------------------------------------------------------------------------


def parse_seeds(spec: str) -> list[int]:
    """``"1-30"``, ``"1,4,9"`` or a mix (``"1-3,7"``)."""
    out: list[int] = []
    for part in spec.split(","):
        part = part.strip()
        if "-" in part:
            lo, hi = part.split("-", 1)
            out.extend(range(int(lo), int(hi) + 1))
        elif part:
            out.append(int(part))
    if not out:
        raise ValueError("no seeds given")
    return sorted(set(out))


def main(argv: Sequence[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m scripts.run_seeds")
    ap.add_argument("--seeds", default="1-30")
    ap.add_argument("--students", type=int, default=SimConfig.n_students)
    ap.add_argument("--events", type=int, default=SimConfig.n_events)
    ap.add_argument("--workers", type=int, default=min(8, os.cpu_count() or 1))
    ap.add_argument("--scenarios", nargs="+", choices=sorted(SCENARIO_BY_NAME))
    ap.add_argument("--n-boot", type=int, default=N_BOOT)
    ap.add_argument("--no-cache", action="store_true")
    ap.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
    a = ap.parse_args(argv)

    seeds = parse_seeds(a.seeds)
    base = SimConfig(n_students=a.students, n_events=a.events)
    if a.scenarios:
        base = replace(base, scenarios=tuple(a.scenarios))

    records: list[SeedRecord] = []
    pool_ex = ProcessPoolExecutor(max_workers=a.workers) if a.workers > 1 else None
    try:
        for s in seeds:
            t0 = time.perf_counter()
            rec, hit = get_seed(
                replace(base, seed=s), a.out_dir, pool_ex, use_cache=not a.no_cache
            )
            records.append(rec)
            print(
                f"seed {s}: {'cache hit' if hit else 'ran'} in "
                f"{time.perf_counter() - t0:.1f}s",
                file=sys.stderr,
            )
    finally:
        if pool_ex is not None:
            pool_ex.shutdown()
    t0 = time.perf_counter()
    rep = pool(records, a.n_boot)
    md, js = write_pooled(rep, a.out_dir)
    print(f"pooled in {time.perf_counter() - t0:.1f}s\nsummary: {md}\njson:    {js}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
