import { getLanguage } from "./i18n";

export type LegalPage = "privacy" | "terms";

/**
 * Public legal page on the API's own origin (`/privacy`, `/terms`, served by
 * `backend/src/legal`), in the app's current language. The API base URL carries
 * the `/api/v1` prefix; the pages live at the site root, so only the origin is
 * used. `null` when there is no base URL to build from.
 */
export function legalUrl(
  page: LegalPage,
  baseURL: string | undefined,
  lang: string = getLanguage(),
): string | null {
  if (!baseURL) return null;
  try {
    return `${new URL(baseURL).origin}/${page}?lang=${lang === "vi" ? "vi" : "en"}`;
  } catch {
    return null;
  }
}
