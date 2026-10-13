import { Controller, Get, Header, Headers, Query } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiExcludeController } from "@nestjs/swagger";
import { renderLegalPage } from "./legal.render";
import type { LegalLang, LegalPage } from "./legal.types";

const PLACEHOLDER_EMAIL = "[set LEGAL_CONTACT_EMAIL]";

/** `?lang=` wins; otherwise the browser's preference; Vietnamese users are the default audience, English is the fallback for everyone else. */
export function pickLang(
  query: string | undefined,
  acceptLanguage: string | undefined,
): LegalLang {
  if (query === "en" || query === "vi") return query;
  const first = acceptLanguage?.split(",")[0]?.trim().toLowerCase() ?? "";
  return first.startsWith("vi") ? "vi" : "en";
}

/**
 * Public privacy policy and terms of service, served by the API itself at
 * `/privacy` and `/terms` (outside the `/api/v1` prefix; see `main.ts`), so the
 * app stores and the login screen can link to a stable URL. No auth, no DB.
 */
@ApiExcludeController()
@Controller()
export class LegalController {
  constructor(private readonly config: ConfigService) {}

  @Get("privacy")
  @Header("Content-Type", "text/html; charset=utf-8")
  @Header("Cache-Control", "public, max-age=3600")
  @Header("Vary", "Accept-Language")
  @Header(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  )
  privacy(
    @Query("lang") lang?: string,
    @Headers("accept-language") acceptLanguage?: string,
  ): string {
    return this.page("privacy", lang, acceptLanguage);
  }

  @Get("terms")
  @Header("Content-Type", "text/html; charset=utf-8")
  @Header("Cache-Control", "public, max-age=3600")
  @Header("Vary", "Accept-Language")
  @Header(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  )
  terms(
    @Query("lang") lang?: string,
    @Headers("accept-language") acceptLanguage?: string,
  ): string {
    return this.page("terms", lang, acceptLanguage);
  }

  private page(
    page: LegalPage,
    lang: string | undefined,
    acceptLanguage: string | undefined,
  ): string {
    const email =
      this.config.get<string>("LEGAL_CONTACT_EMAIL") || PLACEHOLDER_EMAIL;
    return renderLegalPage(page, pickLang(lang, acceptLanguage), email);
  }
}
