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
      passReqToCallback: true,
    });
  }

  async validate(req: Request, email: string, otp: string): Promise<User> {
    const timezone: string = req.headers?.["x-timezone"] || "UTC";

    // example: create or verify user with timezone
    await this.authService.verifyOTPCode(email, otp);
    const user = await this.authService.createUserIfNotExists(email, timezone);

    return user;
  }
}
