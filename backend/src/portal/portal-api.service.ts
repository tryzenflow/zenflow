import { ConfigService } from "@nestjs/config";
import { HttpStatus, Injectable, Logger } from "@nestjs/common";

@Injectable()
export class PortalAPIService {
  private readonly logger = new Logger(PortalAPIService.name);
  private readonly endpoint: string;
  private readonly requestTimeout: number;

  constructor(private configService: ConfigService) {
    this.endpoint = this.configService.getOrThrow("PORTAL_API_URL");
    this.requestTimeout =
      +this.configService.getOrThrow("PORTAL_API_TIMEOUT_MS") || 10000;
  }

  /**
   * DLU student portal (ASP.NET WebForms). A full `__VIEWSTATE` round-trip
   * belongs to the ingestion service; here we submit the standard login form
   * and treat a redirect away from the login page as success.
   */
  async authenticate(username: string, password: string): Promise<string> {
    const loginUrl = `${this.endpoint}/api/authenticate/authpsc`;
    const res = await this.fetch(loginUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: this.configService.getOrThrow("PORTAL_API_KEY"),
        clientid: "vhu",
      },
      body: JSON.stringify({
        password,
        username,
        type: 0,
      }),
    });

    const json = await res.json();

    if (res.status === HttpStatus.OK) {
      if (!("Token" in json))
        throw new Error(`Login successfully, but cannot find token`);

      return json.Token as string;
    }

    if (
      res.status >= HttpStatus.BAD_REQUEST &&
      res.status < HttpStatus.INTERNAL_SERVER_ERROR
    )
      throw new Error(
        `Client error when trying to authenticate portal API (status: ${res.status}, message: ${JSON.stringify(json)})`,
      );
    throw new Error(`Unexpected portal login response (status ${res.status})`);
  }

  private async fetch(url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(this.requestTimeout),
      });
    } catch (err) {
      this.logger.warn(
        `DLU probe request to ${url} failed: ${(err as Error).message}`,
      );
      throw new Error("DLU is unreachable");
    }
  }
}
