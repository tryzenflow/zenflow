import { Module } from "@nestjs/common";
import { OutboundBreakers } from "./outbound-breaker";

/** The one process-wide breaker registry; import wherever an external API is called. */
@Module({ providers: [OutboundBreakers], exports: [OutboundBreakers] })
export class OutboundBreakerModule {}
