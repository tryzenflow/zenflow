import { forwardRef, Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { CryptoModule } from "../crypto/crypto.module";
import { IntegrationsService } from "./integrations.service";
import { IntegrationsController } from "./integrations.controller";
import { LMSModule } from "../lms/lms.module";
import { PortalAPIModule } from "../portal/portal-api.module";
import { IntegrationAuthService } from "./integration-auth.service";
import { IngestionModule } from "../ingestion/ingestion.module";

@Module({
  imports: [
    PrismaModule,
    CryptoModule,
    LMSModule,
    PortalAPIModule,
    // Cyclic on purpose — see the note on `IngestionModule`.
    forwardRef(() => IngestionModule),
  ],
  controllers: [IntegrationsController],
  providers: [IntegrationsService, IntegrationAuthService],
  exports: [IntegrationsService],
})
export class IntegrationsModule {}
