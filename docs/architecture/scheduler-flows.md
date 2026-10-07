# Scheduler sequence flows

Companion to [ARCHITECTURE.md](../../ARCHITECTURE.md), which has the component-level
picture; this one has the call sequences. See
[docs/backend/scheduler.md](../backend/scheduler.md) for the file map and
[ADR-0003](../adr/0003-python-authoritative-placement.md) for why ranking lives in Python.

## Create a single task

```mermaid
sequenceDiagram
  participant C as Sessions API
  participant S as Sessions service
  participant T as Task placement
  participant P as Placer
  participant PC as Bandit client
  participant PY as Bandit service
  participant FB as Fallback placer
  C->>S: create
  S->>S: save session and create event
  S->>T: place on create
  T->>P: place single task
  P->>P: assign policy
  P->>PC: build request from day loads and bandit state
  alt Bandit healthy
    PC->>PY: place
    PY-->>PC: picks and moves
    opt Context missing
      P->>PC: retry with wider horizon
    end
    PC-->>P: results
    P->>P: apply moves, record proposal
  else Bandit unavailable
    PC-->>P: failure
    P->>FB: place with heuristic
    alt Free slot exists
      FB-->>P: start
      P->>P: save start, record degraded proposal
    else No free slot
      P->>FB: retry up to deadline
      P->>P: pin to last resort, never unplaced
    end
  end
  P-->>T: placement result
  T-->>S: placement result
  S-->>C: created session with alternative slot
```

A pairwise-sampled event also carries an alternative slot, which the client can offer as a
pick. See [docs/scheduler/ab-testing.md](../scheduler/ab-testing.md).

## Create a task series

```mermaid
sequenceDiagram
  participant S as Sessions service
  participant T as Task placement
  participant P as Placer
  participant PY as Bandit service
  participant FB as Fallback placer
  S->>S: save series, sessions and create events
  S->>T: place series on create
  T->>P: place series
  P->>P: assign policy once for the series
  alt Bandit healthy
    P->>PY: place whole series
    PY-->>P: one placement per member
    P->>P: pin unplaced, choose alternatives
    P->>P: record proposal per member
  else Bandit unavailable
    P->>FB: place series with heuristic
    FB-->>P: starts for every member
  end
  P->>P: pin any unplaced member
  P-->>T: placements
  T->>T: save start times
  T-->>S: placements
```

A series is one A/B event. The policy is assigned once for the whole series. On a sampled
series the Bandit service runs two independent plans and the API offers a bounded set of
non-overlapping sittings as swaps. A swap is rejected if a sibling has since taken the slot.

## Deadline edit and redistribute

```mermaid
sequenceDiagram
  participant S as Sessions service
  participant T as Task placement
  participant P as Placer
  S->>S: detect deadline change and save
  alt Standalone task
    S->>T: place on deadline change
    Note over T: same as creating a single task
  else Series member
    S->>T: redistribute series
    T->>T: split past and upcoming sessions
    T->>P: place upcoming sessions around the past ones
    T->>T: save series deadline and new starts
  end
```

## Delayed reward

```mermaid
sequenceDiagram
  participant S as Sessions service
  participant F as Feedback service
  participant R as Retained sessions job
  participant BA as Bandit service
  Note over S: First manual move of a scheduled task
  S->>S: record move event
  S->>F: first move
  F->>F: compute reward from drag distance
  F->>F: find the proposal that chose an arm
  F->>BA: update arm state
  F->>F: mark proposal as modified
  Note over R: Runs every 30 minutes
  R->>R: find sessions that elapsed without a move
  R->>F: retained reward
  F->>BA: update arm state
```

## Resize or promote a series

```mermaid
sequenceDiagram
  participant S as Session update
  participant SR as Series service
  participant T as Task placement
  participant P as Placer
  Note over S: Edit with a new session count
  alt Single session becoming a series
    S->>SR: promote to series
    SR->>SR: create series and link session
  end
  S->>SR: resize series
  alt Grow
    SR->>T: check added sittings can be placed
    T-->>SR: feasible
    SR->>SR: save new sessions
    SR->>T: place new sessions
    T->>P: place series
    Note over P: Existing members stay in place
    P-->>T: placements
    T->>T: save start times
  else Shrink
    Note over SR: Reject if a removed session has already started
    SR->>SR: delete highest-numbered sessions
  end
  SR-->>S: all members in order
```
