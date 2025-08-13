import { Injectable } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { Strategy } from "passport-local";
import { AuthService } from "../auth.service";
import { User } from "../../../generated/prisma";

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
  constructor(private authService: AuthService) {
    super({
      usernameField: "email",
      passwordField: "otp",
    });
  }

  async validate(email: string, otp: string): Promise<User> {
    const user = await this.authService.verifyOTPCode(email, otp);
    return user;
  }
}
