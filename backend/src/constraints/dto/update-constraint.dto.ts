import { OmitType, PartialType } from "@nestjs/mapped-types";
import { CreateConstraintsDto as CreateConstraintDto } from "./create-constraint.dto";

export class UpdateConstraintDto extends PartialType(
  OmitType(CreateConstraintDto, ["weekday"])
) {}
