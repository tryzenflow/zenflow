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
import { AuthService } from "./auth.service";
import { CreateUserDto } from "../users/dto";
import { RequestOTPDto } from "./dto";
import { hideEmail } from "./utils/hide-email";
import { CookieAuthGuard, LocalAuthGuard } from "./guards";
import { CurrentUser } from "../users/decorators";
import type { User } from "../../generated/prisma";
import type { Request } from "express";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("otp/request")
  @HttpCode(HttpStatus.OK)
  async requestOTP(@Body() { email }: RequestOTPDto) {
    await this.authService.requestOTPCode(email);
    return {
      message: `OTP code sent to email ${hideEmail(email)} successfully`,
    };
  }

  @UseGuards(LocalAuthGuard)
  @Post("otp/verify")
  @HttpCode(HttpStatus.OK)
  async verifyOTP(@CurrentUser() user: User) {
    return user;
  }

  @UseGuards(CookieAuthGuard)
  @Get("me")
  async me(@CurrentUser() user: User) {
    return user;
  }

  @UseGuards(CookieAuthGuard)
  @Post("logout")
  @HttpCode(HttpStatus.OK)
  logout(@Req() req: Request) {
    req.logOut(() => {});
    req.session.cookie.maxAge = 0;
  }
}
