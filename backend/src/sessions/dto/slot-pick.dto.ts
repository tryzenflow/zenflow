import { IsIn, IsString } from "class-validator";
import type { SlotPickRequest } from "@zenflow/shared";

export class SlotPickDto implements SlotPickRequest {
  @IsString()
  slotProposalId: string;

  @IsIn(["primary", "alternative"])
  chose: "primary" | "alternative";
}
