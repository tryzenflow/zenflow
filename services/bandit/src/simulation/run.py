"""CLI: ``python -m src.simulation.run --seed N [--alpha-sweep] [--students N]``.

Runs every student's paired worlds (multiprocessing over students), builds the
scenario x policy report and writes ``report.md`` + ``report.json`` to
``<out-dir>/seed-N[-sweep]/``. The report is a pure function of the config and
the source, so the same seed reproduces it byte for byte; the result cache
(``.sim_cache/``) skips the run when config and code are unchanged. Wall-clock
time is printed to stderr and never written into the report.
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from collections.abc import Sequence
from concurrent.futures import ProcessPoolExecutor
from dataclasses import replace
from pathlib import Path

from . import cache
from .engine import SimConfig, StudentResult, run_student
from .metrics import build_report
from .render import render_markdown
from .sweep import DEFAULT_ALPHAS, with_sweep
from .world import SCENARIO_BY_NAME

DEFAULT_OUT_DIR = cache.DEFAULT_CACHE_DIR.parent / "sim_out"


def _run_one(args: tuple[SimConfig, int]) -> StudentResult:
    return run_student(*args)


def run_students(cfg: SimConfig, workers: int = 1) -> list[StudentResult]:
    jobs = [(cfg, sid) for sid in range(cfg.n_students)]
    if workers <= 1:
        return [_run_one(j) for j in jobs]
    with ProcessPoolExecutor(max_workers=workers) as pool:
        return list(pool.map(_run_one, jobs, chunksize=1))


def run(
    cfg: SimConfig,
    workers: int = 1,
    use_cache: bool = True,
    cache_dir: Path = cache.DEFAULT_CACHE_DIR,
) -> tuple[dict[str, object], bool]:
    """Report for ``cfg`` and whether it came from the cache."""
    key = cache.cache_key(cfg)
    if use_cache:
        hit = cache.load(key, cache_dir)
        if hit is not None:
            return hit, True
    report = build_report(cfg, run_students(cfg, workers))
    if use_cache:
        cache.store(key, report, cache_dir)
    return report, False


def write_report(report: dict[str, object], out: Path) -> tuple[Path, Path]:
    out.mkdir(parents=True, exist_ok=True)
    js, md = out / "report.json", out / "report.md"
    js.write_text(cache.dumps(report), encoding="utf-8", newline="\n")
    md.write_text(render_markdown(report), encoding="utf-8", newline="\n")
    return md, js


def main(argv: Sequence[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m src.simulation.run")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--students", type=int, default=SimConfig.n_students)
    ap.add_argument("--events", type=int, default=SimConfig.n_events)
    ap.add_argument("--workers", type=int, default=min(8, os.cpu_count() or 1))
    ap.add_argument("--alpha-sweep", action="store_true", help="sweep BANDIT_ALPHA")
    ap.add_argument("--alphas", type=float, nargs="+", help="explicit alpha list")
    ap.add_argument("--scenarios", nargs="+", choices=sorted(SCENARIO_BY_NAME))
    ap.add_argument("--no-cache", action="store_true")
    ap.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
    a = ap.parse_args(argv)

    cfg = SimConfig(seed=a.seed, n_students=a.students, n_events=a.events)
    if a.scenarios:
        cfg = replace(cfg, scenarios=tuple(a.scenarios))
    if a.alphas:
        cfg = replace(cfg, alphas=tuple(a.alphas))
    elif a.alpha_sweep:
        cfg = with_sweep(cfg, DEFAULT_ALPHAS)

    t0 = time.perf_counter()
    report, hit = run(cfg, a.workers, use_cache=not a.no_cache)
    elapsed = time.perf_counter() - t0
    out = a.out_dir / f"seed-{cfg.seed}{'-sweep' if len(cfg.alphas) > 1 else ''}"
    md, js = write_report(report, out)
    print(f"report: {md}\njson:   {js}")
    print(
        f"{'cache hit' if hit else 'ran'} in {elapsed:.1f}s "
        f"({cfg.n_students} students, {a.workers} workers)",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
