import { ExecutionContext } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { Request } from "express";

export class LocalAuthGuard extends AuthGuard("local") {
  async canActivate(context: ExecutionContext) {
    await super.canActivate(context);
    const request: Request = context.switchToHttp().getRequest();
    await super.logIn(request);
    return true;
  }
}
