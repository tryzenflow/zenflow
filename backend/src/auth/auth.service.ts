import type { Cache } from "cache-manager";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { generateOTP } from "./utils";
import { UsersService } from "../users/users.service";
import { MailService } from "../mail/mail.service";
import { SessionsService } from "../sessions/sessions.service";
import type { CreateSessionDto } from "../sessions/dto/create-session.dto";
import type { User } from "../../generated/prisma";
import { localDateStr } from "../scheduler/core/slot";
import { minutesToUtc } from "../common/utils";

/**
 * The 4 default recurring DND blocks seeded onto a brand-new account's
 * calendar (see {@link AuthService.seedDefaultDndBlocks}). `startMinutes` is
 * minutes-from-midnight in the user's own timezone; "Sleep" intentionally
 * crosses midnight (22:00 + 480min = 06:00 the next day) — not a bug, see
 * `CLAUDE.md` invariant 3 / `docs/scheduler/heuristic.md`.
 */
const DEFAULT_DND_BLOCKS: ReadonlyArray<{
  title: string;
  startMinutes: number;
  durationMinutes: number;
}> = [
  { title: "Breakfast", startMinutes: 6 * 60, durationMinutes: 60 },
  { title: "Lunch & rest", startMinutes: 11 * 60, durationMinutes: 120 },
  {
    title: "Evening chill & dinner",
    startMinutes: 17 * 60,
    durationMinutes: 120,
  },
  { title: "Sleep", startMinutes: 22 * 60, durationMinutes: 8 * 60 },
];

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private usersService: UsersService,
    private mailService: MailService,
    private sessionsService: SessionsService,
  ) {}

  async requestOTPCode(email: string) {
    try {
      const otpCode = generateOTP();
      await this.cacheManager.set(`otp:${email}`, otpCode);
      await this.mailService.sendLoginEmail(email, otpCode);
    } catch (error) {
      // Surface the real reason (SMTP auth failure, ECONNREFUSED, invalid
      // from address, template strict-mode error, …) instead of swallowing it.
      this.logger.error(
        `Failed to send OTP email to ${email}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new InternalServerErrorException({
        success: false,
        message: "Failed to send OTP code",
      });
    }
  }

  async createUserIfNotExists(email: string, timezone: string) {
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      const created = await this.usersService.create({ email, timezone });
      // Best-effort: never let seeding failures block signup/login.
      try {
        await this.seedDefaultDndBlocks(created);
      } catch (error) {
        this.logger.warn(
          `Failed to seed default DND blocks for user ${created.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      return created;
    }
    return user;
  }

  /**
   * Seed a brand-new account's calendar with 4 daily recurring DND blocks
   * (breakfast, lunch, evening chill/dinner, sleep) so it isn't empty on day
   * one and the scheduler already knows to avoid these times. Routed through
   * {@link SessionsService.create} — the exact `DND` + `rrule` path a user's
   * own "create a recurring DND" action goes through
   * (`SessionCrudService.createFixedRecurring`) — so no placement/materialization
   * logic is duplicated here. Only called from the `if (!user)` branch of
   * {@link createUserIfNotExists}, which fires once per account, so no extra
   * idempotency guard is needed. Each block is independent and best-effort:
   * one failing doesn't stop the others, and the caller never lets a failure
   * here fail signup.
   */
  private async seedDefaultDndBlocks(user: User): Promise<void> {
    const todayStr = localDateStr(new Date(), user.timezone);

    for (const block of DEFAULT_DND_BLOCKS) {
      try {
        const scheduledStartTime = minutesToUtc(
          todayStr,
          block.startMinutes,
          user.timezone,
        ).toISOString();
        const dto: CreateSessionDto = {
          type: "DND",
          title: block.title,
          durationMinutes: block.durationMinutes,
          scheduledStartTime,
          rrule: "FREQ=DAILY",
          tags: [],
        };
        await this.sessionsService.create(dto, user);
      } catch (error) {
        this.logger.warn(
          `Failed to seed default DND block "${block.title}" for user ${
            user.id
          }: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  async verifyOTPCode(email: string, providedOtp: string) {
    try {
      const otpCode = await this.cacheManager.get<string | null>(
        `otp:${email}`,
      );
      if (!otpCode)
        throw new NotFoundException(
          "OTP Code is not found or may have been expired",
        );

      if (otpCode !== providedOtp) {
        throw new BadRequestException("Incorrect OTP provided");
      }
      await this.cacheManager.del(`otp:${email}`);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException();
    }
  }
}
