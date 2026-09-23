"""A/B split between the HEURISTIC and LINUCB placement policies (issue #62)."""

from __future__ import annotations

from typing import Literal

from src.schemas_place import HeuristicPick, LinucbPick, PlacementMember

Mode = Literal["PLACE", "PREFLIGHT"]
AppliedPolicy = Literal["HEURISTIC", "LINUCB"]


class PolicySelector:
    """Decides which policies to run for a member, and which pick wins.

    ``PREFLIGHT`` always resolves to the heuristic pick — it exists to
    preview a slot without touching bandit state. Otherwise: a member whose
    ``primaryPolicy`` is ``LINUCB`` applies the LinUCB pick when one exists,
    falling back to the heuristic pick when LinUCB found no feasible slot.
    ``computeBoth`` runs the other policy too (for offline comparison /
    telemetry) without changing which pick is applied.
    """

    @staticmethod
    def should_try_linucb(mode: Mode, member: PlacementMember) -> bool:
        """Whether to run the LinUCB scan for this member at all."""
        return mode != "PREFLIGHT" and (
            member.primary_policy == "LINUCB" or member.compute_both
        )

    @staticmethod
    def should_try_heuristic(
        mode: Mode, member: PlacementMember, linucb_pick: LinucbPick | None
    ) -> bool:
        """Whether to run the heuristic scan for this member.

        Runs whenever it's the primary policy, ``computeBoth`` asked for it,
        preflight needs a preview, or LinUCB (already computed) came up
        empty and heuristic is the only fallback left.
        """
        return (
            mode == "PREFLIGHT"
            or member.primary_policy == "HEURISTIC"
            or member.compute_both
            or linucb_pick is None
        )

    @staticmethod
    def resolve(
        mode: Mode,
        member: PlacementMember,
        heuristic_pick: HeuristicPick | None,
        linucb_pick: LinucbPick | None,
    ) -> tuple[AppliedPolicy, int] | None:
        """Pick the applied policy and its start time.

        Returns
        -------
        tuple[AppliedPolicy, int] | None
            ``(policy, start_ms)``, or ``None`` if neither policy found a
            slot (the caller should fall through to infeasible/displacement
            handling).
        """
        if (
            mode != "PREFLIGHT"
            and member.primary_policy == "LINUCB"
            and linucb_pick is not None
        ):
            return "LINUCB", linucb_pick.start_ms
        if heuristic_pick is not None:
            return "HEURISTIC", heuristic_pick.start_ms
        return None
