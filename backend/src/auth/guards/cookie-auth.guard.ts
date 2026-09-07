import {
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from "@nestjs/common";
import { Request } from "express";

export class CookieAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request: Request = context.switchToHttp().getRequest();
    const isAuthenticated = request.isAuthenticated();
    if (!isAuthenticated) throw new UnauthorizedException();
    return true;
  }
}
