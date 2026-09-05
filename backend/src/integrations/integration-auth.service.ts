import { Injectable } from "@nestjs/common";
import type { IntegrationProvider } from "@zenflow/shared";
import { LMSService } from "src/lms/lms.service";
import { PortalAPIService } from "src/portal/portal-api.service";

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
      const { browser, context, page } = await this.lmsService.initBrowser();
      try {
        const cookies = await this.lmsService.authenticate(
          username,
          password,
          page,
          context,
        );
        return cookies.length > 0;
      } finally {
        await browser.close();
      }
    } else {
      const token = await this.portalAPIService.authenticate(
        username,
        password,
      );
      return !!token;
    }
  }
}
