"""Pure numpy port of ``backend/src/scheduler/core/*`` (issue #60).

No I/O, no clock, no randomness: ``now`` is always a parameter. The TypeScript
core is the source of truth; ``tests/test_core_parity.py`` checks this port
against golden JSON fixtures in ``tests/fixtures/golden/``.
"""
