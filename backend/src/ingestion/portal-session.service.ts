import { forwardRef, Inject, Injectable, Logger } from "@nestjs/common";
import { IntegrationsService } from "../integrations/integrations.service";
import { ingestionSignInFailures } from "../observability/metrics";
import { PortalAPIService } from "../portal/portal-api.service";

/**
 * Signs a student into the DLU portal with their stored credentials.
 *
 * Returns `null` when the portal rejects the login or the credentials cannot be
 * read. An open upstream breaker surfaces as `UpstreamUnavailableError` so the
 * queue job can park behind it instead of counting a failure.
 */
@Injectable()
export class PortalSessionService {
  private readonly logger = new Logger(PortalSessionService.name);

  constructor(
    private readonly portal: PortalAPIService,
    @Inject(forwardRef(() => IntegrationsService))
    private readonly integrations: IntegrationsService,
  ) {}

  async token(userId: string): Promise<string | null> {
    let creds: { username: string; password: string };
    try {
      creds = await this.integrations.revealCredentials(userId, "PORTAL");
    } catch (error) {
      ingestionSignInFailures.add(1, { provider: "PORTAL", reason: "error" });
      this.logger.warn(
        `Could not read portal credentials for user ${userId}: ${(error as Error).message}`,
      );
      return null;
    }
    const result = await this.portal.authenticate(
      creds.username,
      creds.password,
    );
    if (!result.ok) {
      ingestionSignInFailures.add(1, {
        provider: "PORTAL",
        reason: "rejected",
      });
      return null;
    }
    return result.token;
  }
}
