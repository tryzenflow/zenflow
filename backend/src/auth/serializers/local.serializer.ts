import { Injectable } from "@nestjs/common";
import { PassportSerializer } from "@nestjs/passport";
import { UsersService } from "../../users/users.service";
import { User } from "../../../generated/prisma";

@Injectable()
export class LocalSerializer extends PassportSerializer {
  constructor(private usersService: UsersService) {
    super();
  }

  serializeUser(user: User, done: (err: unknown, payload?: unknown) => void) {
    done(null, user.id);
  }

  async deserializeUser(
    userId: string,
    done: (err: unknown, payload?: unknown) => void,
  ) {
    // Never let a DB/Redis failure escape as an unhandled rejection: passport
    // calls this without awaiting, so a throw here would crash the process.
    try {
      const user = await this.usersService.findById(userId);
      done(null, user ?? false);
    } catch (err) {
      done(err);
    }
  }
}
