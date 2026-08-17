import random

import numpy as np
import pytest

from src.evaluators.event import Event
from src.evaluators.policy import LinUCBPolicy, Policy, RandomPolicy
from src.evaluators.policy_evaluator import PolicyEvaluator

X = np.ones(2)


class FixedPolicy(Policy):
    """Always plays ``arm``, and records every event handed back to it."""

    def __init__(self, arm: str) -> None:
        self.arm = arm
        self.seen: list[Event] = []

    def select(self, x):
        return self.arm

    def update(self, event):
        self.seen.append(event)


def event(arm: str, payoff: float) -> Event:
    return Event(x=X, arm=arm, payoff=payoff)


class TestReplayAccounting:
    def test_counts_matches_not_mismatches(self):
        """Regression: matched events were discarded and mismatches scored."""
        events = [event("a", 1.0), event("b", 100.0), event("a", 3.0)]
        result = PolicyEvaluator(2, FixedPolicy("a"), events).evaluate()

        assert result.n_matched == 2
        assert result.total_payoff == pytest.approx(4.0)
        assert result.average_payoff == pytest.approx(2.0)

    def test_feeds_only_matched_events_back_to_the_policy(self):
        """Regression: history was filled with the *discarded* events."""
        policy = FixedPolicy("a")
        events = [event("b", 9.0), event("a", 1.0), event("b", 9.0)]
        PolicyEvaluator(1, policy, events).evaluate()

        assert [ev.arm for ev in policy.seen] == ["a"]

    def test_stops_at_n_trials(self):
        events = [event("a", 1.0) for _ in range(10)]
        result = PolicyEvaluator(3, FixedPolicy("a"), events).evaluate()

        assert result.n_matched == 3
        assert result.n_consumed == 3
        assert not result.exhausted

    def test_counts_discarded_events_as_consumed(self):
        events = [event("b", 1.0), event("b", 1.0), event("a", 5.0)]
        result = PolicyEvaluator(1, FixedPolicy("a"), events).evaluate()

        assert result.n_consumed == 3
        assert result.n_matched == 1


class TestExhaustion:
    def test_returns_a_partial_result_instead_of_raising(self):
        """Regression: next() on a drained iterator escaped as StopIteration."""
        events = [event("a", 1.0), event("b", 1.0)]
        result = PolicyEvaluator(100, FixedPolicy("a"), events).evaluate()

        assert result.exhausted
        assert result.n_matched == 1
        assert result.n_requested == 100
        assert result.average_payoff == pytest.approx(1.0)

    def test_handles_zero_matches_without_dividing_by_zero(self):
        result = PolicyEvaluator(5, FixedPolicy("z"), [event("a", 1.0)]).evaluate()

        assert result.n_matched == 0
        assert result.average_payoff == 0.0
        assert result.exhausted

    def test_handles_an_empty_log(self):
        result = PolicyEvaluator(5, FixedPolicy("a"), []).evaluate()
        assert result.n_consumed == 0
        assert result.average_payoff == 0.0

    def test_averages_over_matches_not_requested_trials(self):
        events = [event("a", 4.0), event("a", 6.0)]
        result = PolicyEvaluator(50, FixedPolicy("a"), events).evaluate()
        assert result.average_payoff == pytest.approx(5.0)


class TestConstruction:
    @pytest.mark.parametrize("n_trials", [0, -1])
    def test_rejects_a_non_positive_trial_count(self, n_trials):
        with pytest.raises(ValueError):
            PolicyEvaluator(n_trials, FixedPolicy("a"), [])


class TestEndToEnd:
    def _log(self, n: int, seed: int) -> list[Event]:
        """Uniformly-logged stream where arm ``a`` pays and the others don't."""
        rng = random.Random(seed)
        np_rng = np.random.default_rng(seed)
        payoffs = {"a": 1.0, "b": 0.0, "c": 0.0}
        return [
            Event(
                x=np_rng.normal(size=2),
                arm=(arm := rng.choice(["a", "b", "c"])),
                payoff=payoffs[arm],
            )
            for _ in range(n)
        ]

    def test_linucb_beats_random_on_a_learnable_log(self):
        events = self._log(6000, seed=3)
        arms = ("a", "b", "c")

        linucb = PolicyEvaluator(
            300,
            LinUCBPolicy(arms, n_features=2, alpha=0.5, rng=random.Random(0)),
            events,
        ).evaluate()
        baseline = PolicyEvaluator(
            300, RandomPolicy(arms, rng=random.Random(0)), events
        ).evaluate()

        assert linucb.average_payoff > baseline.average_payoff

    def test_is_reproducible_under_a_seed(self):
        events = self._log(2000, seed=5)
        runs = [
            PolicyEvaluator(
                100,
                LinUCBPolicy(
                    ("a", "b", "c"), n_features=2, alpha=0.5, rng=random.Random(0)
                ),
                events,
            ).evaluate()
            for _ in range(2)
        ]
        assert runs[0] == runs[1]
