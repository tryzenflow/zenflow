# /v1/place contract fixtures

Request/response pairs for `POST /v1/place` (ADR-0003 section 3). Each file is a
`PlaceContractFixture` (`packages/shared/src/placement.ts`). Consumers:

- Jest (`backend/src/scheduler/io/placement-contract.spec.ts`): the frozen TS
  heuristic must agree with every `heuristic` pick here, and each `request` must
  type-check as a `PlaceRequest`.
- pytest (`services/bandit`): `POST /v1/place` with `request` must return
  `response`, ignoring the fields listed in `ignore` (`paramsVersion`, `timingsMs`).

The heuristic scenarios are hand-checked (see each `description`). LinUCB,
pairwise (`computeBoth`), cold-bandit and displacement fixtures need the numpy
math and are added by the Python side (`ml-engineer`) in this directory.
