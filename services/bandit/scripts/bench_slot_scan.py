"""1000-placement benchmark of the vectorized slot scan (issue #60).

    uv run python -m scripts.bench_slot_scan
"""

from __future__ import annotations

import time

import numpy as np

from src.core.constants import MAX_SCAN_DAYS, SLOT_MS
from src.core.slot_score import best_free_slot
from tests.test_core_scan import _scalar_best

N = 1000
NOW = 1_767_571_200_000  # fixed "now" (2026-01-05T00:00Z)
TZ = "Europe/Paris"


def main() -> None:
    rng = np.random.default_rng(0)
    m = rng.uniform(-1, 1, 168)
    we = NOW + MAX_SCAN_DAYS * 86_400_000
    cases = []
    for _ in range(N):
        occ = [
            (NOW + int(a) * SLOT_MS, NOW + int(a) * SLOT_MS + int(b) * SLOT_MS)
            for a, b in zip(
                rng.integers(0, MAX_SCAN_DAYS * 96, 40), rng.integers(2, 16, 40),
                strict=True,
            )
        ]
        cases.append((int(rng.choice([30, 60, 90, 120])), occ))

    best_free_slot(60, [], NOW, we, m, TZ)  # warm the tz offset cache
    t0 = time.perf_counter()
    for dur, occ in cases:
        best_free_slot(dur, occ, NOW, we, m, TZ)
    vec = time.perf_counter() - t0

    k = 20  # scalar reference is slow; time a subset and extrapolate
    t0 = time.perf_counter()
    for dur, occ in cases[:k]:
        _scalar_best(dur, occ, NOW, we, m, TZ)
    sca = (time.perf_counter() - t0) / k * N

    print(f"{N} placements over a {MAX_SCAN_DAYS}-day window ({MAX_SCAN_DAYS*96} slots)")
    print(f"vectorized: {vec:.3f}s total, {vec/N*1000:.3f} ms/placement")
    print(f"scalar ref: ~{sca:.1f}s total (extrapolated from {k}), "
          f"{sca/N*1000:.1f} ms/placement, speedup ~{sca/vec:.0f}x")


if __name__ == "__main__":
    main()
