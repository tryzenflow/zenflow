import { Module } from "@nestjs/common";
import { PortalAPIService } from "./portal-api.service";

@Module({
  providers: [PortalAPIService],
  exports: [PortalAPIService],
})
export class PortalAPIModule {}
