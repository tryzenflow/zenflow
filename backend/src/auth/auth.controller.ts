import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { RateLimit } from "@limitkit/nest";
import { AuthService } from "./auth.service";
import { RequestOTPDto } from "./dto";
import { hideEmail } from "./utils/hide-email";
import { CookieAuthGuard, LocalAuthGuard } from "./guards";
import { CurrentUser } from "../users/decorators/current-user.decorator";
import {
  otpRequestRateLimitRules,
  otpVerifyRateLimitRules,
} from "../common/rate-limit";
import { toUserResponse } from "../users/user-response";
import type { User } from "../../generated/prisma";
import type { Request } from "express";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @RateLimit({ rules: otpRequestRateLimitRules })
  @Post("otp/request")
  @HttpCode(HttpStatus.OK)
  async requestOTP(@Body() { email, lang }: RequestOTPDto) {
    await this.authService.requestOTPCode(email, lang);
    return {
      success: true,
      message: `OTP code sent to email ${hideEmail(email)} successfully`,
    };
  }

  @RateLimit({ rules: otpVerifyRateLimitRules })
  @UseGuards(LocalAuthGuard)
  @Post("otp/verify")
  @HttpCode(HttpStatus.OK)
  async verifyOTP(@CurrentUser() user: User, @Req() req: Request) {
    // Ensure the session is fully persisted to Redis before responding, so the
    // client's immediate post-login requests (me / tasks) aren't rejected by a
    // not-yet-saved session (first-login 403 race).
    await new Promise<void>((resolve, reject) =>
      req.session.save((err?: unknown) =>
        err
          ? reject(
              err instanceof Error ? err : new Error("Failed to save session"),
            )
          : resolve(),
      ),
    );
    return {
      success: true,
      message: "OTP verified successfully. You are now logged in",
      data: toUserResponse(user),
    };
  }

  @UseGuards(CookieAuthGuard)
  @Get("me")
  me(@CurrentUser() user: User) {
    return {
      success: true,
      message: `Welcome back, ${user.name}`,
      data: toUserResponse(user),
    };
  }

  @UseGuards(CookieAuthGuard)
  @Post("logout")
  logout(@Req() req: Request) {
    req.logOut(() => {});
    req.session.cookie.maxAge = 0;
    return {
      success: true,
      message: `Log out successfully`,
    };
  }
}
