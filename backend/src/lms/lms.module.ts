import { Module } from "@nestjs/common";
import { LMSService } from "./lms.service";

@Module({
  providers: [LMSService],
  exports: [LMSService],
})
export class LMSModule {}
