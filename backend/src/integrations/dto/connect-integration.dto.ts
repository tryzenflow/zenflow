import { IsIn, IsNotEmpty, IsString, MaxLength } from "class-validator";
import type {
  ConnectIntegrationInput,
  IntegrationProvider,
} from "@zenflow/shared";

const PROVIDERS: readonly IntegrationProvider[] = ["LMS", "PORTAL"];

/** Body for `POST /integrations` — connect (or re-connect) a DLU account. */
export class ConnectIntegrationDto implements ConnectIntegrationInput {
  @IsIn(PROVIDERS as IntegrationProvider[])
  provider: IntegrationProvider;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  username: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  password: string;
}
