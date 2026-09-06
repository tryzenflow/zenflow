import { ConfigService } from "@nestjs/config";
import { HttpStatus, Injectable, Logger } from "@nestjs/common";
import type {
  PortalExamRow,
  PortalTimetableRow,
} from "../ingestion/core/parse-portal";

/**
 * Outcome of {@link PortalAPIService.authenticate}.
 *
 * Mirrors `LmsLoginResult` on purpose: rejected credentials are a **result**,
 * not an exception, because the caller has to tell them apart from "the portal
 * is down". `IntegrationsService.storeCredentials` maps any throw to a `503`
 * "Couldn't reach DLU", so a wrong password that throws tells a student with a
 * typo that the university is offline. Only genuine transport/site failures
 * throw.
 */
export type PortalAuthResult =
  | { ok: true; token: string }
  | { ok: false; reason: "INVALID_CREDENTIALS" };

/**
 * Statuses the portal answers a rejected login with. Any other 4xx (a 404 from
 * a moved endpoint, say) is the site misbehaving, not the student, so it
 * throws.
 */
const REJECTED_LOGIN_STATUSES: readonly number[] = [
  Number(HttpStatus.BAD_REQUEST),
  Number(HttpStatus.UNAUTHORIZED),
  Number(HttpStatus.FORBIDDEN),
];

/**
 * HTTP client for the DLU student portal API (`PORTAL_API_URL`).
 *
 * Three endpoints, all JSON, all behind the same three headers:
 * `Authorization: Bearer <token>` from {@link PortalAPIService.authenticate},
 * a constant `Clientid: vhu`, and `Apikey` — which comes from
 * `PORTAL_API_KEY` in config and is never hardcoded and never logged.
 *
 * The timetable and exam endpoints are addressed by academic coordinates
 * (`namhoc`, `hocky`, `tuan`), not by date range; `ingestion/core/semester.ts`
 * turns "now" into those. Responses are handed to the pure parsers in
 * `ingestion/core/parse-portal.ts`.
 */
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
   * Exchange a student's portal credentials for the bearer token every other
   * call needs.
   *
   * Returns `{ ok: false, reason: "INVALID_CREDENTIALS" }` when the portal
   * answers and rejects the login (`400`/`401`/`403`); throws only when the
   * portal is unreachable or answers in a shape we cannot make sense of — a
   * `200` with no `Token`, or an unexpected status. See {@link PortalAuthResult}.
   */
  async authenticate(
    username: string,
    password: string,
  ): Promise<PortalAuthResult> {
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

    if (REJECTED_LOGIN_STATUSES.includes(res.status)) {
      // The portal answered — it just doesn't like these credentials. Never
      // log the body: it echoes the submitted username.
      return { ok: false, reason: "INVALID_CREDENTIALS" };
    }

    const json = (await res.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;

    if (res.status === Number(HttpStatus.OK)) {
      const token = json?.Token;
      if (typeof token !== "string" || token.length === 0) {
        throw new Error("Portal accepted the login but returned no token");
      }
      return { ok: true, token };
    }

    throw new Error(`Unexpected portal login response (status ${res.status})`);
  }

  /**
   * One ISO week of class meetings — `GET /api/student/DrawingStudentSchedules`.
   *
   * `tuan` is the ISO week number (`isoWeek()`), which the portal echoes back
   * as each row's `Week`. There is no "current week" shortcut, so the watcher
   * fetches an explicit week at a time. Feed the rows to `parseTimetable`.
   */
  async fetchTimetable(
    token: string,
    namhoc: string,
    hocky: string,
    tuan: number,
  ): Promise<PortalTimetableRow[]> {
    const query = new URLSearchParams({
      namhoc,
      hocky,
      tuan: String(tuan),
    });
    return this.getJson<PortalTimetableRow>(
      `/api/student/DrawingStudentSchedules?${query}`,
      token,
    );
  }

  /**
   * A whole term's exam schedule — `GET /api/student/exam`. One request covers
   * the term, so unlike the timetable there is nothing to paginate. Feed the
   * rows to `parseExams`.
   */
  async fetchExams(
    token: string,
    namhoc: string,
    hocky: string,
  ): Promise<PortalExamRow[]> {
    const query = new URLSearchParams({ namhoc, hocky });
    return this.getJson<PortalExamRow>(`/api/student/exam?${query}`, token);
  }

  /** Authenticated GET returning a JSON array, or `[]` when the portal sends none. */
  private async getJson<T>(path: string, token: string): Promise<T[]> {
    const res = await this.fetch(`${this.endpoint}${path}`, {
      method: "GET",
      headers: this.authHeaders(token),
    });

    if (!res.ok) {
      throw new Error(
        `Portal request to ${path.split("?")[0]} failed (status ${res.status})`,
      );
    }

    const json: unknown = await res.json();
    return Array.isArray(json) ? (json as T[]) : [];
  }

  /** The three headers every authenticated portal call needs. */
  private authHeaders(token: string): Record<string, string> {
    return {
      authorization: `Bearer ${token}`,
      clientid: "vhu",
      // Secret — read from config on every call, never inlined, never logged.
      apikey: this.configService.getOrThrow("PORTAL_API_KEY"),
    };
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
