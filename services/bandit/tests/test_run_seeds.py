"""Multi-seed driver: per-seed records, caching/resume and pooling."""

from __future__ import annotations

from dataclasses import replace
from pathlib import Path

import numpy as np

from scripts import run_seeds as rs
from src.simulation.engine import SimConfig
from src.simulation.run import run

TINY = SimConfig(
    seed=1, n_students=6, n_events=8, scenarios=("single", "series3-tight")
)


def _synthetic(seed: int, regret_diff: float, n: int = 4) -> rs.SeedRecord:
    grid = np.zeros((n, 2, 5, 4))
    grid[:, :, 0, 0] = 10.0  # 10 placements per student per scenario, bucket 0
    grid[:, :, 0, 1] = regret_diff * 10.0
    grid[:, :, 0, 2] = 2.0  # accept diff sum
    grid[:, :, 0, 3] = -5.0
    cells = np.array(["night_owl/stable", "early_bird/stable"] * (n // 2))
    return rs.SeedRecord(seed, cells, grid, np.full((n, 2), -3.0), ("a", "b"))


def test_pooling_statistics() -> None:
    recs = [_synthetic(1, -0.2), _synthetic(2, -0.1), _synthetic(3, 0.1)]
    rep = rs.pool(recs, n_boot=200)
    reg = rep["overall"]["regret"]  # type: ignore[index]
    assert reg["mean_diff"] == round((-0.2 - 0.1 + 0.1) / 3, 6)
    assert reg["min"] == -0.2 and reg["max"] == 0.1
    assert abs(reg["sd"] - float(np.std([-0.2, -0.1, 0.1], ddof=1))) < 1e-6
    assert reg["share_seeds_linucb_better"] == round(2 / 3, 6)
    assert reg["per_seed"] == [-0.2, -0.1, 0.1]
    assert rep["overall"]["accept"]["mean_diff"] == 0.2  # type: ignore[index]
    assert rep["overall"]["ttt"]["mean_diff"] == -3.0  # type: ignore[index]
    # a bucket slice has no time-to-threshold; the empty buckets are dropped
    assert "ttt" not in rep["by_bucket"]["0-5"]  # type: ignore[index]
    assert "regret" not in rep["by_bucket"]["6-10"]  # type: ignore[index]
    # every student has the same ratio, so the pooled CI collapses to the point
    lo, hi = reg["pooled_ci95"]
    assert reg["pooled_diff"] == round((-0.2 - 0.1 + 0.1) / 3, 6)
    assert lo <= reg["pooled_diff"] <= hi
    assert set(rep["by_cell"]) == {"night_owl/stable", "early_bird/stable"}  # type: ignore[call-overload]
    assert rs.pool(recs, n_boot=200) == rep  # deterministic


def test_bootstrap_chunks_do_not_change_with_memory_bound(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    num = np.arange(50, dtype=np.float64)
    den = np.full(50, 5.0)
    ci = rs.bootstrap_ci(num, den, np.random.default_rng(3), 300)
    assert ci[0] < num.sum() / den.sum() < ci[1]
    monkeypatch.setattr(rs, "_CHUNK_ELEMS", 100)  # forces many small chunks
    small = rs.bootstrap_ci(num, den, np.random.default_rng(3), 300)
    assert small[0] < num.sum() / den.sum() < small[1]


def test_parse_seeds() -> None:
    assert rs.parse_seeds("1-3,7") == [1, 2, 3, 7]
    assert rs.parse_seeds("5") == [5]


def test_single_seed_pool_matches_the_report_and_resumes(tmp_path: Path) -> None:
    rec, hit = rs.get_seed(TINY, tmp_path, None)
    again, hit2 = rs.get_seed(TINY, tmp_path, None)
    assert (hit, hit2) == (False, True)
    assert np.array_equal(rec.grid, again.grid) and np.array_equal(rec.ttt, again.ttt)
    assert np.array_equal(rec.cells, again.cells)
    _, hit3 = rs.get_seed(replace(TINY, seed=2), tmp_path, None)
    assert hit3 is False

    rep = rs.pool([rec], n_boot=50)
    report, _ = run(TINY, use_cache=False)
    for m in ("regret", "accept", "drag"):
        want = report["overall"][m]["diff"]  # type: ignore[index]
        assert abs(rep["overall"][m]["pooled_diff"] - want) < 1e-5  # type: ignore[index]
    for name, t in report["time_to_threshold"].items():  # type: ignore[attr-defined]
        got = rep["by_scenario"][name]["ttt"]["pooled_diff"]  # type: ignore[index]
        assert abs(got - t["mean_diff"]) < 1e-5


def test_markdown_renders_all_sections() -> None:
    md = rs.render_markdown(rs.pool([_synthetic(1, -0.2), _synthetic(2, 0.1)], 50))
    for h in ("## Overall", "## By chronotype x behavior", "## By cold-start bucket"):
        assert h in md
    assert "night_owl/stable" in md
