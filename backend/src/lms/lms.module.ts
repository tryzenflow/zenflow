import { Module } from "@nestjs/common";
import { OutboundBreakerModule } from "../common/outbound-breaker.module";
import { LMSService } from "./lms.service";

@Module({
  imports: [OutboundBreakerModule],
  providers: [LMSService],
  exports: [LMSService],
})
export class LMSModule {}
