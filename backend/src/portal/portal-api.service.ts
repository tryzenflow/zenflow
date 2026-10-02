import { ConfigService } from "@nestjs/config";
import { HttpStatus, Injectable, Logger } from "@nestjs/common";
import type {
  PortalExamRow,
  PortalTimetableRow,
} from "../ingestion/core/parse-portal";
import type { PortalRegistHistoryRow } from "../ingestion/core/parse-regist-history";
import { portalClientDuration } from "../observability/metrics";

/** Low-cardinality operation label for the portal RED histogram. */
function portalOperation(url: string): string {
  if (url.includes("/api/authenticate/")) return "authenticate";
  if (url.includes("/DrawingStudentSchedules")) return "fetch_timetable";
  if (url.includes("/api/student/exam")) return "fetch_exams";
  if (url.includes("/api/student/getAllRegistHistory"))
    return "fetch_regist_history";
  return "other";
}

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

/** The two upstream hosts this client talks to; each has its own key and client id. */
interface Upstream {
  base: string;
  clientId: string;
  /** Config key the `Apikey` header is read from — never inlined, never logged. */
  apiKeyConfig: string;
}

/**
 * HTTP client for the DLU student portal API (`PORTAL_API_URL`) and the DKHP
 * registration API (`DKHP_API_URL`).
 *
 * Portal: timetable and exam endpoints, all JSON, all behind the same three
 * headers: `Authorization: Bearer <token>` from
 * {@link PortalAPIService.authenticate}, a constant `Clientid: vhu`, and
 * `Apikey` — which comes from `PORTAL_API_KEY` in config and is never hardcoded
 * and never logged. DKHP: the same login and the same student credentials, with
 * `Clientid: dtl` and `DKHP_API_KEY`; it serves the registration history.
 *
 * The timetable and exam endpoints are addressed by academic coordinates
 * (`academicYear`, `semester`, `tuan`), not by date range; `ingestion/core/semester.ts`
 * turns "now" into those. Responses are handed to the pure parsers in
 * `ingestion/core/parse-portal.ts`.
 */
@Injectable()
export class PortalAPIService {
  private readonly logger = new Logger(PortalAPIService.name);
  private readonly endpoint: string;
  private readonly dkhpEndpoint: string;
  private readonly requestTimeout: number;
  private readonly portalUpstream: Upstream;
  private readonly dkhpUpstream: Upstream;

  constructor(private configService: ConfigService) {
    this.endpoint = this.configService.getOrThrow("PORTAL_API_URL");
    this.dkhpEndpoint = this.configService.getOrThrow("DKHP_API_URL");
    this.portalUpstream = {
      base: this.endpoint,
      clientId: "vhu",
      apiKeyConfig: "PORTAL_API_KEY",
    };
    this.dkhpUpstream = {
      base: this.dkhpEndpoint,
      clientId: "dtl",
      apiKeyConfig: "DKHP_API_KEY",
    };
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
    return this.login(this.portalUpstream, username, password);
  }

  /**
   * The same login against DKHP — same endpoint path, same credentials, with
   * `Clientid: dtl` and `DKHP_API_KEY`. Same contract as {@link authenticate}.
   */
  async authenticateDkhp(
    username: string,
    password: string,
  ): Promise<PortalAuthResult> {
    return this.login(this.dkhpUpstream, username, password);
  }

  private async login(
    upstream: Upstream,
    username: string,
    password: string,
  ): Promise<PortalAuthResult> {
    const loginUrl = `${upstream.base}/api/authenticate/authpsc`;
    const res = await this.fetch(
      loginUrl,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          apikey: this.configService.getOrThrow(upstream.apiKeyConfig),
          clientid: upstream.clientId,
        },
        body: JSON.stringify({
          password,
          username,
          type: 0,
        }),
      },
      upstream === this.dkhpUpstream ? "authenticate_dkhp" : undefined,
    );

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
    academicYear: string,
    semester: string,
    tuan: number,
  ): Promise<PortalTimetableRow[]> {
    const query = new URLSearchParams({
      namhoc: academicYear,
      hocky: semester,
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
    academicYear: string,
    semester: string,
  ): Promise<PortalExamRow[]> {
    const query = new URLSearchParams({
      namhoc: academicYear,
      hocky: semester,
    });
    return this.getJson<PortalExamRow>(`/api/student/exam?${query}`, token);
  }

  /**
   * One term's registration events — `POST /api/student/getAllRegistHistory`
   * on DKHP, body `{p1: year, p2: term}`.
   *
   * The response is an event log (`Status` 1 registered, 0 cancelled), not a
   * current state; `parseRegistHistory` reduces it to the sections the student
   * is in. It answers enrolment discovery (issue #56): one request names every
   * section of the term, so the timetable need not be walked to find them.
   *
   * **The response is a PII surface** (`UpdateStaff` is a student id), so the
   * caller does not store the raw body on its job item.
   */
  async fetchRegistHistory(
    token: string,
    academicYear: string,
    semester: string,
  ): Promise<PortalRegistHistoryRow[]> {
    const path = "/api/student/getAllRegistHistory";
    const res = await this.fetch(`${this.dkhpEndpoint}${path}`, {
      method: "POST",
      headers: {
        ...this.authHeaders(token, this.dkhpUpstream),
        "content-type": "application/json",
      },
      body: JSON.stringify({ p1: academicYear, p2: semester }),
    });

    if (!res.ok) {
      throw new Error(
        `Portal request to ${path} failed (status ${res.status})`,
      );
    }

    const json: unknown = await res.json();
    return Array.isArray(json) ? (json as PortalRegistHistoryRow[]) : [];
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

  /** The three headers every authenticated upstream call needs. */
  private authHeaders(
    token: string,
    upstream: Upstream = this.portalUpstream,
  ): Record<string, string> {
    return {
      authorization: `Bearer ${token}`,
      clientid: upstream.clientId,
      // Secret — read from config on every call, never inlined, never logged.
      apikey: this.configService.getOrThrow(upstream.apiKeyConfig),
    };
  }

  private async fetch(
    url: string,
    init: RequestInit,
    operationOverride?: string,
  ): Promise<Response> {
    const operation = operationOverride ?? portalOperation(url);
    const start = process.hrtime.bigint();
    const record = (status: string) =>
      portalClientDuration.record(
        Number(process.hrtime.bigint() - start) / 1e9,
        { operation, status },
      );
    try {
      const res = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(this.requestTimeout),
      });
      record(String(res.status));
      return res;
    } catch (err) {
      record((err as Error).name === "TimeoutError" ? "timeout" : "error");
      this.logger.warn(
        `DLU probe request to ${url} failed: ${(err as Error).message}`,
      );
      throw new Error("DLU is unreachable");
    }
  }
}
