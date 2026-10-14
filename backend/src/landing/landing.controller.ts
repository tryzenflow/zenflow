import { Controller, Get, Header, Headers, Query } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiExcludeController } from "@nestjs/swagger";
import { pickLang } from "../legal/legal.controller";
import { DEFAULT_APK_URL } from "./landing.content";
import { renderLandingPage } from "./landing.render";

/** Static page: no scripts; `img-src 'self'` and `font-src 'self'` are for the images and Geist in `landing/assets/`, `data:` for the inline favicon. */
const CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/**
 * Public landing page served by the API itself at `/`, plus `robots.txt` and
 * `sitemap.xml` (all outside the `/api/v1` prefix; see `main.ts`). No auth, no DB.
 */
@ApiExcludeController()
@Controller()
export class LandingController {
  constructor(private readonly config: ConfigService) {}

  @Get()
  @Header("Content-Type", "text/html; charset=utf-8")
  @Header("Cache-Control", "public, max-age=300")
  @Header("Vary", "Accept-Language")
  @Header("Content-Security-Policy", CSP)
  landing(
    @Query("lang") lang?: string,
    @Headers("accept-language") acceptLanguage?: string,
  ): string {
    return renderLandingPage(
      pickLang(lang, acceptLanguage),
      this.config.get<string>("APK_URL") || DEFAULT_APK_URL,
      this.config.get<string>("PUBLIC_URL") || undefined,
    );
  }

  @Get("robots.txt")
  @Header("Content-Type", "text/plain; charset=utf-8")
  @Header("Cache-Control", "public, max-age=3600")
  robots(): string {
    const origin = this.origin();
    return [
      "User-agent: *",
      "Allow: /",
      "Disallow: /api/",
      ...(origin ? [`Sitemap: ${origin}/sitemap.xml`] : []),
      "",
    ].join("\n");
  }

  @Get("sitemap.xml")
  @Header("Content-Type", "application/xml; charset=utf-8")
  @Header("Cache-Control", "public, max-age=3600")
  sitemap(): string {
    const origin = this.origin() ?? "";
    const urls = ["/", "/privacy", "/terms"].map(
      (path) => `<url><loc>${origin}${path}</loc></url>`,
    );
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join("")}</urlset>\n`;
  }

  private origin(): string | undefined {
    return (
      this.config.get<string>("PUBLIC_URL")?.replace(/\/+$/, "") || undefined
    );
  }
}
