import { CanActivate, ExecutionContext } from "@nestjs/common";
import { Request } from "express";

export class CookieAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request: Request = context.switchToHttp().getRequest();
    return request.isAuthenticated();
  }
}
