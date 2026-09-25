"""Mirror of the scheduler constants in ``backend/src/scheduler/constants.ts``."""

TIME_GRANULARITY = 15
MS_PER_MINUTE = 60_000
SLOT_MS = TIME_GRANULARITY * MS_PER_MINUTE
HOUR_MS = 60 * MS_PER_MINUTE
DAY_MS = 24 * 60 * MS_PER_MINUTE

MAX_SCAN_DAYS = 60
PREFERENCE_LEARNING_RATE = 0.1
PREFERENCE_RETAINED_WEIGHT = 0.25
STABILITY_WEIGHT = 0.1
STABILITY_SATURATION_HOURS = 4
MOVE_REWARD_SCALE_MINUTES = 240
MATRIX_HALF_LIFE_DAYS = 21

PREFERENCE_SLOTS_PER_DAY = 24
PREFERENCE_MATRIX_LENGTH = 7 * PREFERENCE_SLOTS_PER_DAY
FEATURE_DIM = 7

DURATION_DIVISOR = 480
WORKLOAD_HOURS_DIVISOR = 12
# Day load is two grouped features: fixed blocks the user can't move, and
# flexible work the scheduler places (hours each, / WORKLOAD_HOURS_DIVISOR).
FIXED_LOAD_TYPES = ("LECTURE", "EXAM", "DND")
FLEX_LOAD_TYPES = ("TASK", "ASSIGNMENT")

# LinUCB slot score = linucb + proximity-scaled stability. The stability weight
# is full for a task whose old start is <= NEAR hours away and fades linearly to
# FAR at FAR_HOURS: upcoming tasks barely move, distant ones follow LinUCB.
STABILITY_WEIGHT_NEAR = 1.0
STABILITY_WEIGHT_FAR = 0.05
STABILITY_NEAR_HOURS = 24
STABILITY_FAR_HOURS = 168

# Displacement (issue #62 B).
MAX_DISPLACED_TASKS = 6

# Placement scan scope (ADR-0003; owned by Python, echoed via ``paramsVersion``).
SCAN_CAP_DAYS = 30
MAX_SERIES_PER_DAY = 1
INFEASIBLE_HORIZON_DAYS = 30
