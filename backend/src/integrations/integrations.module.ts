import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { CryptoModule } from "../crypto/crypto.module";
import { IntegrationsService } from "./integrations.service";
import { IntegrationsController } from "./integrations.controller";
import { LMSModule } from "src/lms/lms.module";
import { PortalAPIModule } from "src/portal/portal-api.module";
import { IntegrationAuthService } from "./integration-auth.service";

@Module({
  imports: [PrismaModule, CryptoModule, LMSModule, PortalAPIModule],
  controllers: [IntegrationsController],
  providers: [IntegrationsService, IntegrationAuthService],
  exports: [IntegrationsService],
})
export class IntegrationsModule {}
