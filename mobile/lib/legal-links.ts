import { getLanguage } from "./i18n";

export type LegalPage = "privacy" | "terms";

/** Public site serving `/privacy` and `/terms`, independent of the API host. */
export const SITE_URL = "https://usezenflow.com";

/** Public legal page on the site, in the app's current language. */
export function legalUrl(
  page: LegalPage,
  lang: string = getLanguage(),
  site: string = SITE_URL,
): string {
  return `${site.replace(/\/+$/, "")}/${page}?lang=${lang === "vi" ? "vi" : "en"}`;
}
