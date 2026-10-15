import { LEGAL_CHROME, LEGAL_DOCS, LEGAL_UPDATED } from "./legal.docs";
import type { LegalBlock, LegalLang, LegalPage } from "./legal.types";

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** Escape first, then swap the `{{email}}` token for a mailto link (so a hostile address can't inject markup). */
function inline(text: string, email: string): string {
  const safe = escapeHtml(text);
  const mail = escapeHtml(email);
  // Host before email: the contact address shares the domain.
  return safe
    .replaceAll("usezenflow.com", '<span class="nh">usezenflow.com</span>')
    .replaceAll("{{email}}", `<a href="mailto:${mail}">${mail}</a>`);
}

function block(b: LegalBlock, email: string): string {
  if (typeof b === "string") return `<p>${inline(b, email)}</p>`;
  return `<ul>${b.list.map((li) => `<li>${inline(li, email)}</li>`).join("")}</ul>`;
}

/** "3. Your account" -> number "3" and title "Your account"; headings without a number keep it null. */
function splitHeading(heading: string): { n: string | null; title: string } {
  const m = /^(\d+)\.\s+(.*)$/.exec(heading);
  return m ? { n: m[1], title: m[2] } : { n: null, title: heading };
}

const STYLE = `
:root{color-scheme:light dark;--bg:#fefcfa;--fg:#1c1814;--muted:#7a7066;--rule:#e8e3dc;--primary:#c2540a;--soft:#fbf3ea}
@media (prefers-color-scheme:dark){:root{--bg:#0f0d0a;--fg:#f6f2ec;--muted:#aca295;--rule:#2f2b26;--primary:#ff9a52;--soft:#1a1612}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;scroll-behavior:smooth;scroll-padding-top:16px}
body{margin:0;background:var(--bg);color:var(--fg);font:17px/1.7 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",sans-serif;-webkit-font-smoothing:antialiased}
.sun{height:4px;background:linear-gradient(90deg,#E8895E,#47687C 55%,#B0B8BA)}
.wrap{max-width:700px;margin:0 auto;padding:0 22px}
.top{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-top:22px}
.brand{display:flex;align-items:center;gap:10px;color:var(--fg);text-decoration:none;font-weight:650;font-size:19px;letter-spacing:-.01em}
.lang{display:inline-flex;gap:2px;padding:3px;border:1px solid var(--rule);border-radius:999px}
.lang a{min-width:42px;padding:5px 10px;border-radius:999px;text-align:center;font-size:13px;font-weight:650;letter-spacing:.04em;color:var(--muted);text-decoration:none}
.lang a[aria-current]{background:var(--fg);color:var(--bg)}
.tabs{display:flex;gap:26px;margin-top:18px;border-bottom:1px solid var(--rule);overflow-x:auto;scrollbar-width:none}
.tabs::-webkit-scrollbar{display:none}
.tabs a{flex:none;padding:10px 0 11px;margin-bottom:-1px;border-bottom:2px solid transparent;color:var(--muted);text-decoration:none;font-size:15px;font-weight:550}
.tabs a[aria-current]{color:var(--fg);border-color:var(--primary)}
h1{margin:34px 0 8px;font-size:clamp(30px,7vw,42px);line-height:1.12;letter-spacing:-.025em}
.updated{margin:0 0 22px;color:var(--muted);font-size:14.5px}
.lead{font-size:18px;color:var(--fg)}
p,li{text-align:justify;text-justify:inter-word;hyphens:auto;-webkit-hyphens:auto;text-wrap:pretty;overflow-wrap:anywhere}
p{margin:0 0 15px}
ul{margin:0 0 15px;padding-left:22px}
li{margin:0 0 8px}
li::marker{color:var(--primary)}
a{color:var(--primary);text-underline-offset:3px}
a,.nh{hyphens:none;-webkit-hyphens:none}
.toc{margin:26px 0 8px;border:1px solid var(--rule);border-radius:14px;background:var(--soft)}
.toc summary{cursor:pointer;padding:13px 18px;font-weight:650;font-size:15px;list-style:none}
.toc summary::-webkit-details-marker{display:none}
.toc summary::after{content:"+";float:right;color:var(--muted);font-weight:500}
.toc[open] summary::after{content:"\\2212"}
.toc ol{margin:0;padding:2px 18px 14px;list-style:none;columns:2 240px;column-gap:28px;font-size:15px;line-height:1.45}
.toc li{margin:0 0 7px;text-align:left;break-inside:avoid}
.toc a{color:var(--fg);text-decoration:none}
.toc a:hover{color:var(--primary)}
.toc .n{display:inline-block;min-width:1.6em;color:var(--primary);font-variant-numeric:tabular-nums;font-weight:650}
section{padding:26px 0 12px;border-top:1px solid var(--rule)}
h2{display:flex;align-items:baseline;gap:12px;margin:0 0 12px;font-size:21px;line-height:1.3;letter-spacing:-.012em}
h2 .n{flex:none;min-width:1.4em;color:var(--primary);font-variant-numeric:tabular-nums}
footer{margin-top:30px;padding:22px 0 56px;border-top:1px solid var(--rule);color:var(--muted);font-size:14.5px;display:flex;flex-wrap:wrap;gap:8px 26px}
footer a{color:var(--muted)}
footer a[aria-current]{color:var(--fg);text-decoration:none;font-weight:600}
@media (max-width:480px){body{font-size:16.5px}.lead{font-size:17px}h2{font-size:19.5px}}
`;

export const LOGO = `<svg width="39" height="30" viewBox="38 76 180 140" fill="none" aria-hidden="true"><path d="M52 166 A76 76 0 0 1 204 166" fill="none" stroke="#E8895E" stroke-width="20" stroke-linecap="round"/><path d="M100 166 A28 28 0 0 1 156 166 Z" fill="#E8895E"/><rect x="40" y="180" width="176" height="14" rx="7" fill="#2F4858"/><rect x="64" y="204" width="128" height="8" rx="4" fill="#B0B8BA"/></svg>`;

/** The brand mark as a data URI, so the favicon needs no extra request or file. */
export const FAVICON = `data:image/svg+xml,${encodeURIComponent(
  LOGO.replace(' width="39" height="30"', "").replace(
    ' aria-hidden="true"',
    ' xmlns="http://www.w3.org/2000/svg"',
  ),
)}`;

/**
 * `baseUrl` (the public origin, e.g. `https://usezenflow.com`) turns on the
 * absolute tags (canonical, hreflang alternates, `og:url`); without it they are left out.
 */
export function renderLegalPage(
  page: LegalPage,
  lang: LegalLang,
  email: string,
  baseUrl?: string,
): string {
  const doc = LEGAL_DOCS[page][lang];
  const chrome = LEGAL_CHROME[lang];
  const other: LegalLang = lang === "en" ? "vi" : "en";
  const pages: LegalPage[] = ["privacy", "terms"];

  const origin = baseUrl?.replace(/\/+$/, "");
  const abs = (l: LegalLang) => `${origin}/${page}?lang=${l}`;
  const absoluteTags = origin
    ? [
        `<link rel="canonical" href="${escapeHtml(abs(lang))}">`,
        `<link rel="alternate" hreflang="${lang}" href="${escapeHtml(abs(lang))}">`,
        `<link rel="alternate" hreflang="${other}" href="${escapeHtml(abs(other))}">`,
        `<meta property="og:url" content="${escapeHtml(abs(lang))}">`,
      ].join("\n")
    : "";

  const sections = doc.sections.map((s, i) => ({
    id: `s${i + 1}`,
    ...splitHeading(s.heading),
    body: s.body,
  }));

  const toc = sections
    .map(
      (s) =>
        `<li><a href="#${s.id}">${s.n ? `<span class="n">${escapeHtml(s.n)}</span>` : ""}${escapeHtml(s.title)}</a></li>`,
    )
    .join("");

  const body = sections
    .map(
      (s) =>
        `<section id="${s.id}"><h2>${s.n ? `<span class="n">${escapeHtml(s.n)}</span>` : ""}<span>${escapeHtml(s.title)}</span></h2>${s.body
          .map((b) => block(b, email))
          .join("")}</section>`,
    )
    .join("");

  const langLink = (l: LegalLang) =>
    `<a href="/${page}?lang=${l}" hreflang="${l}" lang="${l}"${l === lang ? ' aria-current="true"' : ""} aria-label="${escapeHtml(LEGAL_CHROME[l].languageName)}">${LEGAL_CHROME[l].languageShort}</a>`;
  const tab = (p: LegalPage) =>
    `<a href="/${p}?lang=${lang}"${p === page ? ' aria-current="page"' : ""}>${escapeHtml(LEGAL_DOCS[p][lang].title)}</a>`;

  return `<!doctype html>
<html lang="${chrome.htmlLang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(chrome.siteTitle(doc.title))}</title>
<meta name="description" content="${escapeHtml(doc.description)}">
<meta name="robots" content="index,follow">
<meta name="theme-color" content="#fefcfa" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0f0d0a" media="(prefers-color-scheme: dark)">
<link rel="icon" type="image/svg+xml" href="${escapeHtml(FAVICON)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Zenflow">
<meta property="og:title" content="${escapeHtml(chrome.siteTitle(doc.title))}">
<meta property="og:description" content="${escapeHtml(doc.description)}">
<meta property="og:locale" content="${lang === "vi" ? "vi_VN" : "en_US"}">
<meta property="og:locale:alternate" content="${other === "vi" ? "vi_VN" : "en_US"}">
${absoluteTags}
<style>${STYLE}</style>
</head>
<body>
<div class="sun"></div>
<div class="wrap">
<header>
<div class="top">
<a class="brand" href="/${page}?lang=${lang}">${LOGO}<span>Zenflow</span></a>
<nav class="lang" aria-label="Language">${langLink("en")}${langLink("vi")}</nav>
</div>
<nav class="tabs" aria-label="Legal">${pages.map(tab).join("")}</nav>
</header>
<main>
<h1>${escapeHtml(doc.title)}</h1>
<p class="updated">${escapeHtml(chrome.updatedLabel)}: ${escapeHtml(chrome.formatDate(LEGAL_UPDATED))}</p>
<p class="lead">${inline(doc.intro, email)}</p>
<details class="toc"><summary>${escapeHtml(chrome.contentsLabel)}</summary><ol>${toc}</ol></details>
${body}
</main>
<footer>
<span>&copy; ${LEGAL_UPDATED.slice(0, 4)} Zenflow. ${escapeHtml(chrome.rightsReserved)}</span>
<a href="/privacy?lang=${lang}"${page === "privacy" ? ' aria-current="page"' : ""}>${escapeHtml(chrome.privacyLink)}</a>
<a href="/terms?lang=${lang}"${page === "terms" ? ' aria-current="page"' : ""}>${escapeHtml(chrome.termsLink)}</a>
</footer>
</div>
</body>
</html>`;
}
