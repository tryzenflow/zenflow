import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { RedisModule } from "../redis/redis.module";
import { KillSwitchService } from "./killswitch.service";
import { MaintenanceGuard } from "./maintenance.guard";

@Global()
@Module({
  imports: [RedisModule],
  providers: [
    KillSwitchService,
    { provide: APP_GUARD, useClass: MaintenanceGuard },
  ],
  exports: [KillSwitchService],
})
export class KillSwitchModule {}
