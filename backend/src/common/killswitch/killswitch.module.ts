import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { KillSwitchService } from "./killswitch.service";
import { MaintenanceGuard } from "./maintenance.guard";

@Global()
@Module({
  providers: [
    KillSwitchService,
    { provide: APP_GUARD, useClass: MaintenanceGuard },
  ],
  exports: [KillSwitchService],
})
export class KillSwitchModule {}
