import { Injectable } from "@nestjs/common";
import type { IntegrationProvider } from "@zenflow/shared";
import { LMSService } from "../lms/lms.service";
import { PortalAPIService } from "../portal/portal-api.service";

/**
 * Live pass/fail probe of a student's DLU credentials, used before
 * `IntegrationsService` encrypts and stores them.
 *
 * The return/throw split is the contract that `storeCredentials` maps to HTTP:
 *  - **`false`** — DLU answered and rejected the credentials → `400`, "check
 *    your username and password".
 *  - **throw** — DLU was unreachable or answered incomprehensibly → `503`,
 *    "try again in a moment".
 *
 * Collapsing the two (as the old Playwright path did, throwing on a wrong
 * password) told every student with a typo that the university was down.
 */
@Injectable()
export class IntegrationAuthService {
  constructor(
    private lmsService: LMSService,
    private portalAPIService: PortalAPIService,
  ) {}

  async verifyCredentials(
    provider: IntegrationProvider,
    username: string,
    password: string,
  ): Promise<boolean> {
    if (provider === "LMS") {
      // `login` reports rejected credentials as `{ ok: false }` and reserves
      // throwing for real transport failures — see LmsLoginResult.
      const result = await this.lmsService.login(username, password);
      return result.ok;
    }

    const token = await this.portalAPIService.authenticate(username, password);
    return !!token;
  }
}
