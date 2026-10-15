import type { APIRoute, GetStaticPaths } from "astro";
import { LANGS, type Lang } from "../../config";
import { COPY } from "../../content/copy";
import { renderShareCard } from "../../og/card";

export const getStaticPaths: GetStaticPaths = () => LANGS.map((lang) => ({ params: { lang } }));

export const GET: APIRoute = async ({ params }) => {
  const png = await renderShareCard(COPY[params.lang as Lang]);
  return new Response(png as BodyInit, { headers: { "Content-Type": "image/png" } });
};
