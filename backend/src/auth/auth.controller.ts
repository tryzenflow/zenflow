import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { CreateUserDto } from "../users/dto";
import { RequestOTPDto, VerifyOTPDto } from "./dto";
import { hideEmail } from "./utils/hide-email";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("otp/request")
  @HttpCode(HttpStatus.OK)
  async requestOTP(@Body() { email }: RequestOTPDto) {
    await this.authService.requestOTPCode(email);
    return {
      success: true,
      message: `OTP code sent to email ${hideEmail(email)} successfully`,
    };
  }

  @Post("otp/verify")
  @HttpCode(HttpStatus.OK)
  async verifyOTP(@Body() { email, providedOtp }: VerifyOTPDto) {
    await this.authService.verifyOTPCode(email, providedOtp);
    return { success: true, message: "OTP verified. You are now logged in" };
  }

  @Post("register")
  async register(@Body() { email, timezone }: CreateUserDto) {
    const response = await this.authService.createUserIfNotExist({
      email,
      timezone,
    });
    return { success: true, ...response };
  }
}
