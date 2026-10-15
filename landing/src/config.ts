/** Build-time links. Override with the `PUBLIC_*` env vars in landing/README.md. */
export const SITE_URL = (import.meta.env.PUBLIC_SITE_URL || "https://usezenflow.com").replace(/\/+$/, "");

/** Same default as the Nest landing (`backend/src/landing/landing.content.ts`). */
export const APK_URL =
  import.meta.env.PUBLIC_APK_URL ||
  "https://github.com/tryzenflow/releases/releases/latest/download/zenflow-android.apk";

export const CONTACT_EMAIL = "privacy@usezenflow.com";

export type Lang = "en" | "vi";
export const LANGS: Lang[] = ["en", "vi"];

/** Page path for a language: `/` and `/vi/`. */
export const pathFor = (lang: Lang): string => (lang === "en" ? "/" : "/vi/");

export const legalUrl = (page: "privacy" | "terms", lang: Lang): string =>
  `${SITE_URL}/${page}${lang === "vi" ? "?lang=vi" : ""}`;
