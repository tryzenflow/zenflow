import { Injectable, Logger } from "@nestjs/common";
import type { IntegrationProvider } from "@zenflow/shared";

/** Hard ceiling on a single probe request. */
const REQUEST_TIMEOUT_MS = 10_000;

const ENDPOINTS: Record<IntegrationProvider, string> = {
  LMS: "https://lms.dlu.edu.vn",
  PORTAL: "https://online.dlu.edu.vn",
};

/**
 * Best-effort **live credential check** against the real DLU systems.
 *
 * Scope (issue #28): this only needs a pass/fail so a wrong password fails
 * loudly at connect time instead of silently breaking a background watcher
 * days later. The real session capture + scraping lives in the ingestion
 * service (issues #27 / #29 / #30); the detection heuristics here are
 * deliberately shallow and are the one seam those issues will replace.
 *
 * Contract:
 * - resolves `true`  — credentials confirmed good
 * - resolves `false` — the site clearly rejected the credentials
 * - throws           — the site was unreachable / returned something
 *                      unparseable (caller surfaces this as "try again",
 *                      never as "bad password")
 */
@Injectable()
export class DluAuthService {
  private readonly logger = new Logger(DluAuthService.name);

  async verifyCredentials(
    provider: IntegrationProvider,
    username: string,
    password: string,
  ): Promise<boolean> {
    return provider === "LMS"
      ? this.verifyMoodle(username, password)
      : this.verifyPortal(username, password);
  }

  /** DLU LMS is Moodle: pull a `logintoken`, POST it with the credentials. */
  private async verifyMoodle(
    username: string,
    password: string,
  ): Promise<boolean> {
    const loginUrl = `${ENDPOINTS.LMS}/login/index.php`;
    const page = await this.get(loginUrl);
    const token =
      /name="logintoken"[^>]*value="([^"]+)"/.exec(page.body)?.[1] ?? "";

    const res = await this.fetch(loginUrl, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: page.setCookie,
      },
      body: new URLSearchParams({
        username,
        password,
        logintoken: token,
        anchor: "",
      }).toString(),
      redirect: "manual",
    });

    // Moodle 302s to `/`, `/my/`, or `/login/index.php?testsession=...` on a
    // good login and re-renders `/login/index.php` with an error box on a bad
    // one.
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location") ?? "";
      return !/\/login\/index\.php\??$/.test(location);
    }
    const body = await res.text();
    if (/loginerror|invalid login|Invalid login/i.test(body)) return false;
    throw new Error(`Unexpected LMS login response (status ${res.status})`);
  }

  /**
   * DLU student portal (ASP.NET WebForms). A full `__VIEWSTATE` round-trip
   * belongs to the ingestion service; here we submit the standard login form
   * and treat a redirect away from the login page as success.
   */
  private async verifyPortal(
    username: string,
    password: string,
  ): Promise<boolean> {
    const loginUrl = `${ENDPOINTS.PORTAL}/`;
    const page = await this.get(loginUrl);

    const hidden = (name: string): string =>
      new RegExp(`name="${name}"[^>]*value="([^"]*)"`).exec(page.body)?.[1] ??
      "";

    const res = await this.fetch(loginUrl, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: page.setCookie,
      },
      body: new URLSearchParams({
        __VIEWSTATE: hidden("__VIEWSTATE"),
        __VIEWSTATEGENERATOR: hidden("__VIEWSTATEGENERATOR"),
        __EVENTVALIDATION: hidden("__EVENTVALIDATION"),
        txtUsername: username,
        txtPassword: password,
        btnLogin: "Đăng nhập",
      }).toString(),
      redirect: "manual",
    });

    if (res.status >= 300 && res.status < 400) return true;
    const body = await res.text();
    // The portal re-renders the form with a validation summary on failure.
    if (/sai tên đăng nhập|mật khẩu|invalid|không đúng/i.test(body)) {
      return false;
    }
    throw new Error(`Unexpected portal login response (status ${res.status})`);
  }

  private async get(url: string): Promise<{ body: string; setCookie: string }> {
    const res = await this.fetch(url, { method: "GET" });
    return {
      body: await res.text(),
      // Enough for the immediate follow-up POST; a real cookie jar is the
      // ingestion service's job.
      setCookie: (res.headers.get("set-cookie") ?? "")
        .split(/,(?=[^ ;]+=)/)
        .map((c) => c.split(";")[0].trim())
        .filter(Boolean)
        .join("; "),
    };
  }

  private async fetch(url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      this.logger.warn(
        `DLU probe request to ${url} failed: ${(err as Error).message}`,
      );
      throw new Error("DLU is unreachable");
    }
  }
}
