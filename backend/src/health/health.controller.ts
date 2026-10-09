import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { HealthReport, HealthService } from "./health.service";

/**
 * Served by both roles (ADR-0011): under `/api/v1` on the API, bare on the
 * worker. Errors are 503 so load balancers and compose healthchecks act on them.
 */
@Controller("health")
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** All dependencies: Postgres, both Redis instances, bandit when configured. */
  @Get()
  async all() {
    return this.wrap(await this.health.all());
  }

  /** Process is up; touches no dependency. */
  @Get("live")
  live() {
    return {
      success: true,
      message: "Service is live",
      data: { status: "ok" },
    };
  }

  /** Ready to serve: Postgres + Redis. */
  @Get("ready")
  async ready() {
    return this.wrap(await this.health.ready());
  }

  /** `{ success, message, data }` on both outcomes; failures stay HTTP 503. */
  private wrap(report: HealthReport) {
    const ok = report.status === "ok";
    const body = {
      success: ok,
      message: ok ? "All checks passed" : "One or more checks failed",
      data: report,
    };
    if (!ok) throw new ServiceUnavailableException(body);
    return body;
  }
}
