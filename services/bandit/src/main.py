"""Replay-evaluation demo: LinUCB vs. a uniformly random baseline.

Generates a synthetic uniformly-logged event stream (the assumption replay
evaluation needs), then scores both policies on it.

    uv run python -m src.main
"""

from __future__ import annotations

import random

import numpy as np

from .evaluators.event import Event
from .evaluators.policy import LinUCBPolicy, Policy, RandomPolicy
from .evaluators.policy_evaluator import PolicyEvaluator

ARMS = ("morning", "afternoon", "evening")
N_FEATURES = 4
N_EVENTS = 20_000
N_TRIALS = 500
SEED = 42


def make_events(rng: random.Random, n: int) -> list[Event]:
    """Synthesize a uniformly-logged stream with a per-arm linear reward."""
    np_rng = np.random.default_rng(rng.randrange(2**32))
    true_theta = {arm: np_rng.normal(size=N_FEATURES) for arm in ARMS}

    events: list[Event] = []
    for _ in range(n):
        x = np_rng.normal(size=N_FEATURES)
        arm = rng.choice(ARMS)  # uniform logging policy
        payoff = float(true_theta[arm] @ x) + float(np_rng.normal(scale=0.1))
        events.append(Event(x=x, arm=arm, payoff=payoff))
    return events


def report(name: str, policy: Policy, events: list[Event]) -> None:
    result = PolicyEvaluator(N_TRIALS, policy, events).evaluate()
    note = " (log exhausted)" if result.exhausted else ""
    print(
        f"{name:>8}: avg payoff {result.average_payoff:+.4f} "
        f"over {result.n_matched} matches / {result.n_consumed} events{note}"
    )


def main() -> None:
    rng = random.Random(SEED)
    events = make_events(rng, N_EVENTS)

    report("random", RandomPolicy(ARMS, rng=random.Random(SEED)), events)
    report(
        "linucb",
        LinUCBPolicy(ARMS, N_FEATURES, alpha=1.0, rng=random.Random(SEED)),
        events,
    )


if __name__ == "__main__":
    main()
