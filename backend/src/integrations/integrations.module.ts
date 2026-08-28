import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { CryptoModule } from "../crypto/crypto.module";
import { IntegrationsService } from "./integrations.service";
import { IntegrationsController } from "./integrations.controller";
import { DluAuthService } from "./dlu-auth.service";

@Module({
  imports: [PrismaModule, CryptoModule],
  controllers: [IntegrationsController],
  providers: [IntegrationsService, DluAuthService],
  exports: [IntegrationsService],
})
export class IntegrationsModule {}
