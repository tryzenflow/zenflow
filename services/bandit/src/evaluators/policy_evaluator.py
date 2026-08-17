"""Unbiased offline (replay) evaluation — Li et al., 2010, Algorithm 3.

The logged stream must come from a policy that chose arms uniformly at random;
under that assumption, keeping only the events where the policy under evaluation
agrees with the logged arm yields an unbiased estimate of its online payoff.
"""

from __future__ import annotations

from dataclasses import dataclass

from .event import Event
from .policy import Policy


@dataclass(frozen=True, slots=True)
class EvaluationResult:
    """Outcome of a replay run.

    Attributes:
        average_payoff: Mean payoff over *matched* events, or 0.0 if none matched.
        total_payoff: Summed payoff over matched events.
        n_matched: Events the policy agreed with and therefore learned from.
        n_consumed: Events read from the log, matched or discarded.
        n_requested: Trials asked for. When ``n_matched < n_requested`` the log
            ran out first and the estimate rests on fewer samples than intended.
    """

    average_payoff: float
    total_payoff: float
    n_matched: int
    n_consumed: int
    n_requested: int

    @property
    def exhausted(self) -> bool:
        """True if the event log ran out before ``n_requested`` matches."""
        return self.n_matched < self.n_requested


class PolicyEvaluator:
    """Replays a logged event stream against a policy."""

    def __init__(self, n_trials: int, policy: Policy, events: list[Event]) -> None:
        if n_trials <= 0:
            raise ValueError(f"n_trials must be positive, got {n_trials}")
        self._n_trials = n_trials
        self._policy = policy
        self._events = events

    def evaluate(self) -> EvaluationResult:
        """Run the replay until ``n_trials`` matches or the log is exhausted.

        An event is **retained** when the policy's choice matches the logged arm
        — it counts toward the payoff and is fed back to the policy. A mismatch
        is **discarded**, leaving the policy's state untouched; that asymmetry is
        what makes the estimate unbiased.
        """
        total_payoff = 0.0
        n_matched = 0
        n_consumed = 0

        for event in self._events:
            n_consumed += 1
            if self._policy.select(event.x) != event.arm:
                continue

            self._policy.update(event)
            total_payoff += event.payoff
            n_matched += 1
            if n_matched == self._n_trials:
                break

        return EvaluationResult(
            average_payoff=total_payoff / n_matched if n_matched else 0.0,
            total_payoff=total_payoff,
            n_matched=n_matched,
            n_consumed=n_consumed,
            n_requested=self._n_trials,
        )
