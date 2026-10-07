"""Seeded synthetic-student simulator: preference heuristic vs LinUCB (issue #60).

Runs the real ``src.core`` / ``src.models`` scheduling code (no DB, no HTTP)
against composed chronotype x behavior students whose hidden utility is neither
policy's model class. It validates mechanics and sensitivity, not real-world
superiority. Entry point: ``python -m src.simulation.run``.
"""
