import {
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from "@nestjs/common";
import { Request } from "express";
import { isEmailDomainAllowed } from "../utils/email-domain";

export class CookieAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request: Request = context.switchToHttp().getRequest();
    const isAuthenticated = request.isAuthenticated();
    if (!isAuthenticated) throw new UnauthorizedException();
    // `ALLOWED_EMAIL_DOMAINS`: a session opened before the rule shipped (they
    // are rolling and last 7 days from the last use) must not outlive it.
    const email = (request.user as { email?: string } | undefined)?.email;
    if (email && !isEmailDomainAllowed(email))
      throw new UnauthorizedException();
    return true;
  }
}
