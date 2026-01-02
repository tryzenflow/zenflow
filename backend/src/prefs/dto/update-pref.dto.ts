import { OmitType, PartialType } from "@nestjs/mapped-types";
import { CreateUserPreferenceDto } from "./create-pref.dto";

export class UpdateUserPreferenceDto extends PartialType(
  OmitType(CreateUserPreferenceDto, ["day"]),
) {}
