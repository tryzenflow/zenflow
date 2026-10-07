import { Module } from "@nestjs/common";
import { OutboundBreakerModule } from "../common/outbound-breaker.module";
import { PortalAPIService } from "./portal-api.service";

@Module({
  imports: [OutboundBreakerModule],
  providers: [PortalAPIService],
  exports: [PortalAPIService],
})
export class PortalAPIModule {}
