import random
from typing import Any

import numpy as np
import pytest

from src.models.linucb import LinUCB


def make_model(**kwargs: Any) -> LinUCB:
    params: dict[str, Any] = {"n_features": 3, "alpha": 1.0, "rng": random.Random(0)}
    params.update(kwargs)
    return LinUCB(**params)


class TestConstruction:
    @pytest.mark.parametrize(
        "kwargs",
        [
            {"n_features": 0},
            {"n_features": -1},
            {"alpha": -0.5},
            {"ridge": 0.0},
            {"ridge": -1.0},
        ],
    )
    def test_rejects_invalid_hyperparameters(self, kwargs):
        with pytest.raises(ValueError):
            make_model(**kwargs)

    def test_arms_are_created_lazily(self):
        model = make_model()
        before = model.arms
        assert before == ()

        model.select_arm({"a": np.ones(3), "b": np.ones(3)})
        after = model.arms
        assert after == ("a", "b")


class TestSelectArm:
    def test_runs_on_a_fresh_model(self):
        """Regression: float16 state made linalg reject the very first call."""
        model = make_model()
        assert model.select_arm({"a": np.ones(3), "b": np.ones(3)}) in {"a", "b"}

    def test_rejects_empty_candidate_set(self):
        with pytest.raises(ValueError):
            make_model().select_arm({})

    @pytest.mark.parametrize("bad", [np.ones(2), np.ones((3, 1)), np.ones((3, 3))])
    def test_rejects_misshaped_context(self, bad):
        with pytest.raises(ValueError, match="shape"):
            make_model().select_arm({"a": bad})

    def test_prefers_the_arm_with_higher_observed_payoff(self):
        model = make_model(alpha=0.0)  # pure exploitation
        x = np.array([1.0, 0.0, 0.0])
        for _ in range(10):
            model.update("good", x, 1.0)
            model.update("bad", x, -1.0)

        assert model.select_arm({"good": x, "bad": x}) == "good"

    def test_exploration_bonus_favors_the_less_sampled_arm(self):
        model = make_model(alpha=10.0)
        x = np.array([1.0, 0.0, 0.0])
        for _ in range(50):
            model.update("known", x, 1.0)
        model.update("rare", x, 0.9)

        assert model.select_arm({"known": x, "rare": x}) == "rare"

    def test_ties_are_broken_across_arms_not_by_insertion_order(self):
        x = np.ones(3)
        chosen = {
            LinUCB(3, 1.0, rng=random.Random(seed)).select_arm({"a": x, "b": x})
            for seed in range(25)
        }
        assert chosen == {"a", "b"}

    def test_same_seed_gives_the_same_choice(self):
        x = np.ones(3)
        first = LinUCB(3, 1.0, rng=random.Random(7)).select_arm({"a": x, "b": x})
        second = LinUCB(3, 1.0, rng=random.Random(7)).select_arm({"a": x, "b": x})
        assert first == second


class TestUpdate:
    def test_accepts_an_arm_never_selected(self):
        """Regression: replay updates arms chosen by the *logging* policy."""
        model = make_model()
        model.update("never-selected", np.ones(3), 1.0)
        assert model.arms == ("never-selected",)

    def test_accumulates_into_a_and_b(self):
        """Regression: a (d, 1) column b made this raise on broadcast."""
        model = make_model(ridge=1.0)
        x = np.array([1.0, 2.0, 3.0])
        model.update("a", x, 2.0)

        params = model._get_or_create_arm("a")
        np.testing.assert_allclose(params.A, np.identity(3) + np.outer(x, x))
        np.testing.assert_allclose(params.b, 2.0 * x)

    def test_state_stays_float64(self):
        model = make_model()
        model.update("a", np.ones(3), 1.0)
        params = model._get_or_create_arm("a")
        assert params.A.dtype == np.float64
        assert params.b.dtype == np.float64

    def test_survives_payoffs_beyond_float16_range(self):
        model = make_model()
        big = np.full(3, 500.0)
        for _ in range(20):
            model.update("a", big, 1.0)
        assert np.isfinite(model._get_or_create_arm("a").A).all()

    def test_invalidates_the_inverse_cache(self):
        model = make_model()
        x = np.array([1.0, 0.0, 0.0])
        before = model.theta("a").copy()
        model.update("a", x, 5.0)
        assert not np.allclose(before, model.theta("a"))

    def test_recovers_a_linear_reward(self):
        model = make_model(n_features=2, ridge=1e-6)
        true_theta = np.array([2.0, -1.0])
        rng = np.random.default_rng(0)
        for _ in range(500):
            x = rng.normal(size=2)
            model.update("a", x, float(true_theta @ x))

        np.testing.assert_allclose(model.theta("a"), true_theta, atol=1e-3)


class TestRidge:
    def test_seeds_a_at_lambda_times_identity(self):
        model = make_model(ridge=2.5)
        np.testing.assert_allclose(
            model._get_or_create_arm("a").A, 2.5 * np.identity(3)
        )

    def test_theta_is_zero_before_any_observation(self):
        np.testing.assert_allclose(make_model().theta("a"), np.zeros(3))

    def test_stronger_ridge_shrinks_theta(self):
        x = np.array([1.0, 0.0, 0.0])
        weak = make_model(ridge=0.01)
        strong = make_model(ridge=100.0)
        weak.update("a", x, 1.0)
        strong.update("a", x, 1.0)

        assert np.linalg.norm(strong.theta("a")) < np.linalg.norm(weak.theta("a"))
