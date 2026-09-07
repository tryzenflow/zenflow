import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseEnumPipe,
  Post,
  Patch,
  UseGuards,
} from "@nestjs/common";
import type { IntegrationProvider } from "@zenflow/shared";
import { CookieAuthGuard } from "../auth/guards";
import { CurrentUser } from "../users/decorators/current-user.decorator";
import { type User } from "../../generated/prisma";
import { IntegrationsService } from "./integrations.service";
import { ConnectIntegrationDto } from "./dto/connect-integration.dto";
import { UpdateIntegrationDto } from "./dto/update-integration.dto";

/** Runtime shape for `ParseEnumPipe` on the `:provider` path param. */
const IntegrationProviderEnum: Record<
  IntegrationProvider,
  IntegrationProvider
> = { LMS: "LMS", PORTAL: "PORTAL" };

@Controller("integrations")
@UseGuards(CookieAuthGuard)
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

  /** Connect (or re-connect) a DLU account after a live login check. */
  @Post()
  async connect(@CurrentUser() user: User, @Body() dto: ConnectIntegrationDto) {
    const data = await this.integrations.connect(user, dto);
    return {
      success: true,
      message: `${dto.provider} account connected`,
      data,
    };
  }

  /** Connection status for every provider. */
  @Get()
  async list(@CurrentUser() user: User) {
    const data = await this.integrations.status(user);
    return { success: true, message: "Integration status", data };
  }

  /**
   * Run this provider's ingestion watchers for the current user, right now.
   *
   * The manual counterpart to the crons — the same `run()`, narrowed to one
   * student — so a connected account can be verified end to end without waiting
   * for the next tick. Returns the provider's status, whose `lastSyncedAt` /
   * `lastSyncStatus` describe the run just performed.
   */
  @Post(":provider/sync")
  async sync(
    @CurrentUser() user: User,
    @Param("provider", new ParseEnumPipe(IntegrationProviderEnum))
    provider: IntegrationProvider,
  ) {
    const data = await this.integrations.sync(user, provider);
    return {
      success: true,
      message: `${provider} sync finished`,
      data,
    };
  }

  @Patch(":provider")
  async update(
    @CurrentUser() user: User,
    @Param("provider", new ParseEnumPipe(IntegrationProviderEnum))
    provider: IntegrationProvider,
    @Body() dto: UpdateIntegrationDto,
  ) {
    const data = await this.integrations.update(user, provider, dto);
    return {
      success: true,
      message: `${provider} account credentials updated`,
      data,
    };
  }

  /** Disconnect a provider. Idempotent. */
  @Delete(":provider")
  async disconnect(
    @CurrentUser() user: User,
    @Param("provider", new ParseEnumPipe(IntegrationProviderEnum))
    provider: IntegrationProvider,
  ) {
    const data = await this.integrations.disconnect(user, provider);
    return {
      success: true,
      message: `${provider} account disconnected`,
      data,
    };
  }
}
