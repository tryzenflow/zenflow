"""Placement policies for ``POST /v1/place`` — one class per concern.

:class:`~src.policies.heuristic.HeuristicPolicy` and
:class:`~src.policies.linucb.LinucbPolicy` each pick a slot for one member;
:class:`~src.policies.selector.PolicySelector` is the A/B split deciding
which of the two computed picks (if either) gets applied. Orchestration
(caching, timing, the per-member/per-request loop) stays in :mod:`src.place`.
"""
