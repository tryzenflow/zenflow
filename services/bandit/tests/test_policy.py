import random

import numpy as np
import pytest

from src.evaluators.event import Event
from src.evaluators.policy import LinUCBPolicy, Policy, RandomPolicy

ARMS = ("a", "b", "c")


class TestPolicyBase:
    def test_cannot_be_instantiated(self):
        with pytest.raises(TypeError):
            Policy()  # type: ignore[abstract]

    def test_update_defaults_to_a_no_op(self):
        policy = RandomPolicy(ARMS, rng=random.Random(0))
        policy.update(Event(x=np.ones(3), arm="a", payoff=1.0))


class TestRandomPolicy:
    def test_selects_without_any_history(self):
        """Regression: arms were inferred from history, empty on the first call."""
        policy = RandomPolicy(ARMS, rng=random.Random(0))
        assert policy.select(np.ones(3)) in ARMS

    def test_rejects_an_empty_arm_set(self):
        with pytest.raises(ValueError):
            RandomPolicy([])

    def test_covers_every_arm(self):
        """Regression: random.choice over a set raised TypeError."""
        policy = RandomPolicy(ARMS, rng=random.Random(0))
        assert {policy.select(np.ones(3)) for _ in range(200)} == set(ARMS)

    def test_is_reproducible_under_a_seed(self):
        x = np.ones(3)
        draws = [
            [RandomPolicy(ARMS, rng=random.Random(1)).select(x) for _ in range(10)]
            for _ in range(2)
        ]
        assert draws[0] == draws[1]

    def test_deduplicates_and_sorts_arms(self):
        policy = RandomPolicy(["b", "a", "b"], rng=random.Random(0))
        assert policy._arms == ("a", "b")


class TestLinUCBPolicy:
    def test_selects_from_the_configured_arms(self):
        policy = LinUCBPolicy(ARMS, n_features=3, alpha=1.0, rng=random.Random(0))
        assert policy.select(np.ones(3)) in ARMS

    def test_rejects_an_empty_arm_set(self):
        with pytest.raises(ValueError):
            LinUCBPolicy([], n_features=3, alpha=1.0)

    def test_update_feeds_the_underlying_model(self):
        policy = LinUCBPolicy(ARMS, n_features=3, alpha=1.0, rng=random.Random(0))
        policy.update(Event(x=np.ones(3), arm="a", payoff=1.0))
        assert "a" in policy.model.arms

    def test_learns_to_prefer_the_rewarding_arm(self):
        policy = LinUCBPolicy(ARMS, n_features=2, alpha=0.0, rng=random.Random(0))
        x = np.array([1.0, 0.0])
        for _ in range(30):
            policy.update(Event(x=x, arm="a", payoff=1.0))
            policy.update(Event(x=x, arm="b", payoff=0.0))
            policy.update(Event(x=x, arm="c", payoff=0.0))

        assert policy.select(x) == "a"
