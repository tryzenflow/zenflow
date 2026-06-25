/**
 * Phase-2 transparency-UI types (ADR 0001 "@zenflow/shared type deltas").
 *
 * These shapes are owned by `@zenflow/shared` (`packages/shared/src/{user,api}.ts`)
 * per CLAUDE.md invariant #1. This module is a thin aggregator so the Phase-2 UI
 * has a single import surface; it re-exports the shared types rather than
 * redefining them. Nothing here duplicates an API shape.
 */

export type {
  DurationAdjustmentMode,
  User,
  UserPreferences,
} from "@zenflow/shared";

export type {
  CreateTaskResponse,
  DisplacedTask,
  PreferenceMatrixResponse,
  RescheduleResponse,
  SchedulingMeta,
  SchedulingRationale,
  Task,
} from "@zenflow/shared";
