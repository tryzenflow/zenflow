import { PartialType, OmitType } from "@nestjs/mapped-types";
import { ConnectIntegrationDto } from "./connect-integration.dto";

/** Body for `PATCH /integrations/:provider` — partial credential updates. */
export class UpdateIntegrationDto extends PartialType(
  OmitType(ConnectIntegrationDto, ["provider"] as const),
) {}
