import type { APIRoute } from "astro";
import { LANGS, SITE_URL, legalUrl, pathFor } from "../config";

export const GET: APIRoute = () => {
  const urls = [...LANGS.map((l) => `${SITE_URL}${pathFor(l)}`), legalUrl("privacy", "vi"), legalUrl("terms", "vi")];
  const body = urls.map((u) => `<url><loc>${u}</loc></url>`).join("");
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>\n`,
    { headers: { "Content-Type": "application/xml; charset=utf-8" } },
  );
};
