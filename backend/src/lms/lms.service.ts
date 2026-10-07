import { Injectable, Logger } from "@nestjs/common";
import {
  classifyHttpResult,
  OutboundBreakers,
} from "../common/outbound-breaker";
import { ConfigService } from "@nestjs/config";
import type { MoodleMonthlyView } from "../ingestion/core/parse-lms";
import type { MoodleEnrolledCourse } from "../ingestion/core/parse-enrolled-courses";
import { lmsClientDuration } from "../observability/metrics";

/** Low-cardinality operation label for the LMS RED histogram. */
/**
 * Low-cardinality operation label for the LMS RED histogram.
 *
 * Every AJAX method shares one path (`/lib/ajax/service.php`), so the label has
 * to come from the `info=` query parameter — otherwise two very differently
 * priced calls would share one histogram.
 */
function lmsOperation(url: string): string {
  if (url.includes("/lib/ajax/service.php")) {
    const method = /[?&]info=([^&]+)/.exec(url)?.[1] ?? "";
    if (method.includes("calendar_monthly_view")) return "fetch_monthly_view";
    if (method.includes("enrolled_courses")) return "fetch_enrolled_courses";
    return "ajax_other";
  }
  if (url.includes("/login/") || url.includes("/my/")) return "login";
  return "other";
}

/**
 * HTTP client for the LMS (a Moodle at `LMS_URL`).
 *
 * Plain `fetch` — no browser, no Playwright. Everything the watchers need is
 * reachable with two form posts and one AJAX call, so driving Chromium just to
 * read JSON was pure cost (a ~400 MB image layer and seconds per login).
 *
 * ## Where `sesskey` comes from
 *
 * Moodle's AJAX endpoint requires a `sesskey` CSRF token that is **never** a
 * cookie and never a response header — which is why it is invisible in the
 * Network tab. It is rendered into the body of every authenticated page, in
 * the inline `M.cfg` script block, in hidden `<input name="sesskey">` fields,
 * and inside the URLs Moodle prints (our own capture leaks one in an event's
 * `editurl`). It is bound to the `MoodleSession` cookie and rotates with it.
 *
 * ## Login is a four-step dance
 *
 * 1. `GET /login/index.php` → scrape the one-shot `logintoken`, keep the
 *    anonymous `MoodleSession`.
 * 2. `POST /login/index.php` (form-encoded, `redirect: "manual"`) → on success
 *    Moodle **regenerates the session id**, so the new `MoodleSession` from
 *    `set-cookie` is the one that counts; carrying the old one forward yields
 *    a silently logged-out client.
 * 3. `GET /my/` with the new cookie → pull `sesskey` out of `M.cfg`.
 * 4. `POST /lib/ajax/service.php?sesskey=…&info=…` for the actual data.
 *
 * DLU sessions expire quickly, so nothing is cached across runs — a watcher
 * holds one {@link LmsSession} for the duration of a single run so the cost is
 * `1 login + N fetches` rather than `N × (login + fetch)`.
 */

/**
 * Safety stop for the enrolled-courses cursor walk.
 *
 * A student has tens of enrolments, not thousands, so reaching this means the
 * server is not advancing `nextoffset` — better to log and return what we have
 * than to loop forever inside one sync pass.
 */
const MAX_ENROLLED_COURSE_PAGES = 50;

/** One authenticated Moodle session: the cookie plus its bound CSRF token. */
export interface LmsSession {
  /** `MoodleSession=…`, ready for a `cookie` header. */
  cookie: string;
  sesskey: string;
}

/**
 * Outcome of {@link LMSService.login}.
 *
 * Rejected credentials are a **result**, not an exception, because the caller
 * has to tell them apart from "DLU is down": the former is a `400` telling the
 * student to check their password, the latter a `503` telling them to try
 * again later. Only genuine transport/site failures throw.
 */
export type LmsLoginResult =
  | { ok: true; session: LmsSession }
  | { ok: false; reason: "INVALID_CREDENTIALS" };

/** Moodle's own markers for a rejected login re-render. */
const LOGIN_ERROR_MARKERS = [
  "loginerror",
  "invalid login",
  "invalidlogin",
  "sai tên đăng nhập",
];

@Injectable()
export class LMSService {
  private readonly logger = new Logger(LMSService.name);
  private readonly endpoint: string;
  private readonly requestTimeout: number;

  /** Breaker name; also the `upstream` label on its metrics. */
  static readonly BREAKER = "dlu-lms";

  constructor(
    private readonly configService: ConfigService,
    private readonly breakers: OutboundBreakers,
  ) {
    this.endpoint = this.configService
      .getOrThrow<string>("LMS_URL")
      .replace(/\/+$/, "");
    this.requestTimeout =
      +this.configService.getOrThrow("LMS_TIMEOUT_MS") || 15000;
  }

  /** Ms until the LMS breaker may admit a call, or `null` when it can. */
  unavailableFor(): number | null {
    return this.breakers.unavailableFor(LMSService.BREAKER);
  }

  /**
   * Sign in and return the `{ cookie, sesskey }` pair every other call needs.
   *
   * Returns `{ ok: false }` for rejected credentials; throws only when DLU is
   * unreachable or answers in a shape we cannot make sense of.
   */
  async login(username: string, password: string): Promise<LmsLoginResult> {
    const loginUrl = `${this.endpoint}/login/index.php`;

    // 1 — the login form: a one-shot CSRF token plus an anonymous session.
    const form = await this.fetch(loginUrl, { method: "GET" });
    const formHtml = await form.text();
    const logintoken = /name="logintoken"\s+value="([^"]*)"/.exec(
      formHtml,
    )?.[1];
    let cookie = this.sessionCookie(form) ?? "";

    // 2 — submit. `redirect: "manual"` so the 3xx (and its Set-Cookie) is
    // visible instead of being swallowed by the fetch redirect chase.
    const submitted = await this.fetch(loginUrl, {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...(cookie ? { cookie } : {}),
      },
      body: new URLSearchParams({
        username,
        password,
        anchor: "",
        ...(logintoken ? { logintoken } : {}),
      }).toString(),
    });

    // Moodle regenerates the session id on a successful login; the cookie set
    // on THIS response is the authenticated one.
    cookie = this.sessionCookie(submitted) ?? cookie;

    if (submitted.status >= 300 && submitted.status < 400) {
      // A rejected login bounces straight back to the bare form; an accepted
      // one redirects to `…/login/index.php?testsession=<id>` or to a wanted
      // page, both of which carry a query string.
      const location = submitted.headers.get("location") ?? "";
      if (/\/login\/index\.php\/?$/.test(location)) {
        return { ok: false, reason: "INVALID_CREDENTIALS" };
      }
    } else {
      // DLU answers the POST with 200 rather than a redirect, so "did it work"
      // has to be read off the body: a rejection re-renders the form with an
      // error, a success renders the page we were headed for. An unrecognised
      // 200 is NOT treated as a failure — the sesskey lookup below is the real
      // check, and it distinguishes the two without guessing at wording.
      const haystack = (await submitted.text()).toLowerCase();
      if (LOGIN_ERROR_MARKERS.some((marker) => haystack.includes(marker))) {
        return { ok: false, reason: "INVALID_CREDENTIALS" };
      }
    }

    if (!cookie)
      throw new Error("LMS accepted the login but set no session cookie");

    // 3 — any authenticated page carries `M.cfg`; /my/ is the cheapest.
    const dashboard = await this.fetch(`${this.endpoint}/my/`, {
      method: "GET",
      headers: { cookie },
    });
    const sesskey = /"sesskey":"([A-Za-z0-9]+)"/.exec(
      await dashboard.text(),
    )?.[1];
    if (!sesskey) {
      throw new Error("Signed in to the LMS but found no sesskey on /my/");
    }

    return { ok: true, session: { cookie, sesskey } };
  }

  /**
   * One month of the student's Moodle calendar, as
   * `core_calendar_get_calendar_monthly_view` returns it.
   *
   * `month` is 1-based, as Moodle expects. `courseid: 1` is the site course —
   * it scopes the request to "everything the user can see", not to one course.
   * Feed the result to `parseMonthlyView` (`ingestion/core/parse-lms.ts`).
   *
   * Note there is deliberately no per-course variant available: Moodle's AJAX
   * surface has no "this course's calendar" method, which is why the issue-#56
   * occurrence cache for the LMS can only be filled by a student's own walk.
   */
  async fetchMonthlyView(
    session: LmsSession,
    year: number,
    month: number,
  ): Promise<MoodleMonthlyView> {
    return this.callAjax<MoodleMonthlyView>(
      session,
      "core_calendar_get_calendar_monthly_view",
      {
        year,
        month,
        courseid: 1,
        includenavigation: false,
        mini: true,
        day: 1,
      },
      "calendar",
    ).then((data) => data ?? {});
  }

  /**
   * Every course the student is enrolled in, across every term.
   *
   * The LMS half of enrolment discovery (issue #56): it answers "which courses
   * might this student have items in" without walking their calendar, so a
   * student whose courses are all cache-fresh can be skipped.
   *
   * `classification: "allincludinghidden"` returns the student's **entire**
   * enrolment history, not the current term — which is why the caller has to run
   * `classifyCurrentTerm` over the result, and why that filter is advisory until
   * it has been checked against a real account.
   *
   * Paginates on `nextoffset`. `limit: 0` asks Moodle for its own page size, so
   * the cursor has to be followed rather than assumed; `pageSize` overrides it,
   * which is how the fixture server exercises a multi-page walk.
   */
  async fetchEnrolledCourses(
    session: LmsSession,
    opts: { pageSize?: number } = {},
  ): Promise<MoodleEnrolledCourse[]> {
    const courses: MoodleEnrolledCourse[] = [];
    let offset = 0;

    for (let page = 0; page < MAX_ENROLLED_COURSE_PAGES; page++) {
      const data = await this.callAjax<{
        courses?: MoodleEnrolledCourse[] | null;
        nextoffset?: number | null;
      }>(
        session,
        "core_course_get_enrolled_courses_by_timeline_classification",
        {
          offset,
          limit: opts.pageSize ?? 0,
          classification: "allincludinghidden",
          sort: "fullname",
          customfieldname: "",
          customfieldvalue: "",
        },
        "enrolled courses",
      );

      const batch = data?.courses ?? [];
      courses.push(...batch);

      const next = data?.nextoffset;
      // Stop on an empty page, a missing cursor, or a cursor that does not
      // advance. The last guard matters: a server that keeps echoing the same
      // `nextoffset` would otherwise spin forever. Same belt-and-braces as the
      // `page.length < BATCH_SIZE` check in `eachIntegrationTarget`.
      if (
        batch.length === 0 ||
        typeof next !== "number" ||
        !Number.isFinite(next) ||
        next <= offset
      ) {
        return courses;
      }
      offset = next;
    }

    this.logger.warn(
      `Stopped paginating enrolled courses after ${MAX_ENROLLED_COURSE_PAGES} pages`,
    );
    return courses;
  }

  /**
   * One Moodle AJAX call, unwrapped.
   *
   * Extracted so the request envelope exists once: the `[{ index, methodname,
   * args }]` body, the `?sesskey=&info=` query, and — the part that is easy to
   * get wrong — the fact that this endpoint **always answers HTTP 200** and puts
   * failures in the payload's `error` / `exception` instead of in the status.
   *
   * `label` only shapes the error message, so a failure names the call a reader
   * recognises rather than the method's full Moodle identifier.
   */
  private async callAjax<T>(
    session: LmsSession,
    methodname: string,
    args: Record<string, unknown>,
    label: string,
  ): Promise<T | null> {
    const url =
      `${this.endpoint}/lib/ajax/service.php` +
      `?sesskey=${encodeURIComponent(session.sesskey)}&info=${methodname}`;

    const res = await this.fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: session.cookie,
      },
      body: JSON.stringify([{ index: 0, methodname, args }]),
    });

    if (!res.ok) {
      throw new Error(`LMS ${label} request failed (status ${res.status})`);
    }

    const payload = (await res.json()) as
      | { error?: unknown; data?: T; exception?: unknown }[]
      | null;
    const envelope = payload?.[0];
    if (!envelope) throw new Error(`Empty LMS ${label} response`);
    if (envelope.error) {
      throw new Error(
        `LMS ${label} returned an error: ${JSON.stringify(envelope.exception ?? envelope.error)}`,
      );
    }
    return envelope.data ?? null;
  }

  /** `MoodleSession=<id>` from a response's `Set-Cookie`, if it sets one. */
  private sessionCookie(res: Response): string | null {
    for (const raw of res.headers.getSetCookie()) {
      const match = /^(MoodleSession[^=]*)=([^;]*)/.exec(raw);
      if (match && match[2]) return `${match[1]}=${match[2]}`;
    }
    return null;
  }

  /**
   * Every outbound call: a hard timeout, and transport failures collapsed into
   * one "unreachable" error the integrations layer maps to a `503`. Never logs
   * the URL's query string or any body — a login POST carries a password.
   */
  private async fetch(url: string, init: RequestInit): Promise<Response> {
    // The breaker refuses (UpstreamUnavailableError) without a request while
    // open. Only transport trouble counts; see `classifyHttpResult`.
    return this.breakers.run(LMSService.BREAKER, () => this.send(url, init), {
      classify: (r) => classifyHttpResult(r),
    });
  }

  private async send(url: string, init: RequestInit): Promise<Response> {
    const operation = lmsOperation(url);
    const start = process.hrtime.bigint();
    const record = (status: string) =>
      lmsClientDuration.record(Number(process.hrtime.bigint() - start) / 1e9, {
        operation,
        status,
      });
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
        `LMS request to ${url.split("?")[0]} failed: ${(err as Error).message}`,
      );
      throw new Error("LMS is unreachable");
    }
  }
}
