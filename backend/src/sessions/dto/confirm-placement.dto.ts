import { IsUUID } from "class-validator";
import type { ConfirmPlacementRequest } from "@zenflow/shared";

/** `POST /sessions/placement/confirm`: the `id` of a plan the scheduler returned. */
export class ConfirmPlacementDto implements ConfirmPlacementRequest {
  @IsUUID()
  planId!: string;
}
