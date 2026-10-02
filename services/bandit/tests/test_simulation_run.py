"""End-to-end smoke: determinism, seed sensitivity, cache, CLI."""

from __future__ import annotations

from dataclasses import replace
from pathlib import Path

from src.simulation import cache
from src.simulation.engine import SimConfig
from src.simulation.render import render_markdown
from src.simulation.run import main, run, write_report

TINY = SimConfig(
    seed=1, n_students=3, n_events=8, scenarios=("single", "series3-tight")
)


def test_same_seed_is_byte_identical_and_other_seed_differs(tmp_path: Path) -> None:
    a, hit_a = run(TINY, use_cache=False)
    b, hit_b = run(TINY, use_cache=False)
    c, _ = run(replace(TINY, seed=2), use_cache=False)
    assert not hit_a and not hit_b
    assert cache.dumps(a) == cache.dumps(b)
    assert render_markdown(a) == render_markdown(b)
    assert cache.dumps(a) != cache.dumps(c)
    md, js = write_report(a, tmp_path)
    assert md.read_bytes() == write_report(b, tmp_path / "again")[0].read_bytes()
    assert js.read_text(encoding="utf-8") == cache.dumps(a)


def test_workers_do_not_change_the_report() -> None:
    serial, _ = run(TINY, workers=1, use_cache=False)
    parallel, _ = run(TINY, workers=2, use_cache=False)
    assert cache.dumps(serial) == cache.dumps(parallel)


def test_cache_hit_returns_the_same_report(tmp_path: Path) -> None:
    first, hit1 = run(TINY, cache_dir=tmp_path)
    second, hit2 = run(TINY, cache_dir=tmp_path)
    assert (hit1, hit2) == (False, True)
    assert cache.dumps(first) == cache.dumps(second)
    assert render_markdown(first) == render_markdown(second)  # same row order
    # a different config is a different key
    _, hit3 = run(replace(TINY, seed=9), cache_dir=tmp_path)
    assert hit3 is False


def test_cache_key_tracks_the_source(tmp_path: Path) -> None:
    root = tmp_path / "src"
    for d in ("core", "models", "policies", "simulation"):
        (root / d).mkdir(parents=True)
        (root / d / "x.py").write_text("A = 1\n")
    k1 = cache.cache_key(TINY, root)
    assert k1 == cache.cache_key(TINY, root)
    (root / "core" / "x.py").write_text("A = 2\n")
    assert cache.cache_key(TINY, root) != k1
    assert cache.cache_key(replace(TINY, ridge=2.0), root) != cache.cache_key(
        TINY, root
    )


def test_cli_writes_a_report_with_cis_buckets_and_cells(tmp_path: Path) -> None:
    code = main(
        [
            "--seed", "3", "--students", "15", "--events", "6",
            "--scenarios", "single", "--workers", "1", "--no-cache",
            "--out-dir", str(tmp_path),
        ]
    )  # fmt: skip
    assert code == 0
    text = (tmp_path / "seed-3" / "report.md").read_text(encoding="utf-8")
    for needle in ("95% CI", "Cold-start buckets", "0-5", "40+", "Time to threshold"):
        assert needle in text
    assert text.count("early_bird/") + text.count("night_owl/") >= 5  # per-cell rows
