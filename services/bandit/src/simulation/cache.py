"""Result cache keyed by hash(config + source of the code the simulator runs).

Editing any file under ``src/core``, ``src/models``, ``src/policies`` or
``src/simulation`` (or the config) changes the key, so a stale report is never
served. The cache stores the finished report JSON; the directory is gitignored.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict
from pathlib import Path

from .engine import SimConfig

_ROOT = Path(__file__).resolve().parents[2]  # services/bandit
DEFAULT_CACHE_DIR = _ROOT / ".sim_cache"
_SOURCE_DIRS = ("core", "models", "policies", "simulation")
_SCHEMA = 1  # bump when the report layout changes


def source_hash(src_root: Path | None = None) -> str:
    root = src_root or _ROOT / "src"
    h = hashlib.sha256()
    for d in _SOURCE_DIRS:
        for f in sorted((root / d).rglob("*.py")):
            h.update(f.relative_to(root).as_posix().encode())
            h.update(f.read_bytes().replace(b"\r\n", b"\n"))
    return h.hexdigest()


def cache_key(cfg: SimConfig, src_root: Path | None = None) -> str:
    payload = (
        json.dumps(asdict(cfg), sort_keys=True) + f"|{_SCHEMA}|{source_hash(src_root)}"
    )
    return hashlib.sha256(payload.encode()).hexdigest()[:24]


def load(key: str, cache_dir: Path = DEFAULT_CACHE_DIR) -> dict[str, object] | None:
    f = cache_dir / f"{key}.json"
    if not f.exists():
        return None
    data: dict[str, object] = json.loads(f.read_text(encoding="utf-8"))
    return data


def store(
    key: str, report: dict[str, object], cache_dir: Path = DEFAULT_CACHE_DIR
) -> Path:
    cache_dir.mkdir(parents=True, exist_ok=True)
    f = cache_dir / f"{key}.json"
    f.write_text(dumps(report), encoding="utf-8", newline="\n")
    return f


def dumps(report: dict[str, object]) -> str:
    """Canonical JSON (sorted keys, fixed separators, trailing newline)."""
    return json.dumps(report, sort_keys=True, indent=2, ensure_ascii=True) + "\n"
