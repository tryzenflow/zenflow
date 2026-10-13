import type { Cache } from "cache-manager";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import {
  BadRequestException,
  HttpException,
  Inject,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { Lang } from "@zenflow/shared";
import { KillSwitchService } from "../common/killswitch/killswitch.service";
import {
  EMAIL_DOMAIN_NOT_ALLOWED,
  allowedEmailDomains,
  generateOTP,
  isEmailDomainAllowed,
} from "./utils";
import { UsersService } from "../users/users.service";
import { MailService } from "../mail/mail.service";

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private usersService: UsersService,
    private mailService: MailService,
    private killSwitch: KillSwitchService,
  ) {}

  /**
   * `ALLOWED_EMAIL_DOMAINS` (production only) limits sign-in to those domains.
   * Checked before a code is mailed, so nothing is sent to other addresses, and
   * again at verify/create in case a code was issued before the rule shipped.
   */
  private assertEmailAllowed(email: string): void {
    const allowed = allowedEmailDomains();
    if (isEmailDomainAllowed(email, allowed)) return;
    throw new ForbiddenException({
      success: false,
      message: `Sign-in is limited to ${allowed.map((d) => `@${d}`).join(", ")} emails`,
      code: EMAIL_DOMAIN_NOT_ALLOWED,
    });
  }

  async requestOTPCode(email: string, lang?: Lang) {
    this.assertEmailAllowed(email);
    try {
      const otpCode = generateOTP();
      await this.cacheManager.set(`otp:${email}`, otpCode);
      await this.mailService.sendLoginEmail(email, otpCode, undefined, lang);
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
    this.assertEmailAllowed(email);
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      if (!(await this.killSwitch.isEnabled("signups"))) {
        throw new ServiceUnavailableException({
          success: false,
          message: "Sign-ups are temporarily disabled",
        });
      }
      const created = await this.usersService.create({ email, timezone });
      return created;
    }
    return user;
  }

  async verifyOTPCode(email: string, providedOtp: string) {
    this.assertEmailAllowed(email);
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
