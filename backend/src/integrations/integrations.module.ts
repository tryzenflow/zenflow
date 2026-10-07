import { forwardRef, Module } from "@nestjs/common";
import { RedisModule } from "../common/redis/redis.module";
import { PrismaModule } from "../prisma/prisma.module";
import { CryptoModule } from "../crypto/crypto.module";
import { IntegrationsService } from "./integrations.service";
import { IntegrationsController } from "./integrations.controller";
import { LMSModule } from "../lms/lms.module";
import { PortalAPIModule } from "../portal/portal-api.module";
import { IntegrationAuthService } from "./integration-auth.service";
import { SyncInflightGuard } from "./sync-inflight.service";
import { IngestionModule } from "../ingestion/ingestion.module";

@Module({
  imports: [
    PrismaModule,
    RedisModule, // SyncInflightGuard's RATE_LIMIT_REDIS_CLIENT
    CryptoModule,
    LMSModule,
    PortalAPIModule,
    // Cyclic on purpose — see the note on `IngestionModule`.
    forwardRef(() => IngestionModule),
  ],
  controllers: [IntegrationsController],
  providers: [IntegrationsService, IntegrationAuthService, SyncInflightGuard],
  exports: [IntegrationsService],
})
export class IntegrationsModule {}
