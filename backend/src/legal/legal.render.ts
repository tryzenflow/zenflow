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
  return safe.replaceAll("{{email}}", `<a href="mailto:${mail}">${mail}</a>`);
}

function block(b: LegalBlock, email: string): string {
  if (typeof b === "string") return `<p>${inline(b, email)}</p>`;
  return `<ul>${b.list.map((li) => `<li>${inline(li, email)}</li>`).join("")}</ul>`;
}

const STYLE = `
:root{--bg:#fefcfa;--fg:#0f0d0a;--muted:#797065;--border:#e8e5df;--primary:#c2540a;--card:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#0f0d0a;--fg:#fbfaf8;--muted:#aca397;--border:#36322d;--primary:#ff9a52;--card:#1d1a17}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.65 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-text-size-adjust:100%}
header,main,footer{max-width:720px;margin:0 auto;padding:0 20px}
header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-top:24px;padding-bottom:8px}
.brand{display:flex;align-items:center;gap:10px;font-weight:600;font-size:19px;color:var(--fg);text-decoration:none}
nav{display:flex;gap:6px;flex-wrap:wrap;font-size:14px}
nav a{padding:6px 12px;border:1px solid var(--border);border-radius:999px;color:var(--muted);text-decoration:none}
nav a[aria-current=page]{background:var(--primary);border-color:var(--primary);color:#fff}
h1{font-size:32px;line-height:1.2;letter-spacing:-.02em;margin:28px 0 6px}
h2{font-size:19px;margin:34px 0 8px;letter-spacing:-.01em}
.updated{color:var(--muted);font-size:14px;margin:0 0 18px}
p{margin:0 0 14px}ul{margin:0 0 14px;padding-left:22px}li{margin:0 0 6px}
a{color:var(--primary)}
footer{padding-top:32px;padding-bottom:48px;color:var(--muted);font-size:14px;border-top:1px solid var(--border);margin-top:40px}
`;

const LOGO = `<svg width="30" height="30" viewBox="0 0 260 260" fill="none" aria-hidden="true"><circle cx="130" cy="130" r="130" fill="url(#g)"/><path d="M220.5 51.5C220.5 51.5 172.668 65.7587 147.635 89.6235C122.602 113.488 136.249 158.201 104.912 183.517C80.2542 203.436 33 199.5 33 199.5" stroke="#FFF085" stroke-width="24" stroke-linecap="round"/><defs><linearGradient id="g" x1="48.5" y1="31.5" x2="222.5" y2="220.5" gradientUnits="userSpaceOnUse"><stop stop-color="#FF6900"/><stop offset=".3236" stop-color="#F0B100"/><stop offset="1" stop-color="#D8F999"/></linearGradient></defs></svg>`;

export function renderLegalPage(
  page: LegalPage,
  lang: LegalLang,
  email: string,
): string {
  const doc = LEGAL_DOCS[page][lang];
  const chrome = LEGAL_CHROME[lang];
  const other: LegalLang = lang === "en" ? "vi" : "en";
  const otherPage: LegalPage = page === "privacy" ? "terms" : "privacy";
  const otherTitle = LEGAL_DOCS[otherPage][lang].title;

  const body = doc.sections
    .map(
      (s) =>
        `<section><h2>${escapeHtml(s.heading)}</h2>${s.body
          .map((b) => block(b, email))
          .join("")}</section>`,
    )
    .join("");

  return `<!doctype html>
<html lang="${chrome.htmlLang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(doc.title)} · Zenflow</title>
<link rel="alternate" hreflang="${other}" href="/${page}?lang=${other}">
<style>${STYLE}</style>
</head>
<body>
<header>
<a class="brand" href="/${page}?lang=${lang}">${LOGO}<span>Zenflow</span></a>
<nav aria-label="Legal">
<a href="/${page}?lang=${other}" hreflang="${other}">${escapeHtml(LEGAL_CHROME[other].languageName)}</a>
<a href="/${otherPage}?lang=${lang}">${escapeHtml(otherTitle)}</a>
</nav>
</header>
<main>
<h1>${escapeHtml(doc.title)}</h1>
<p class="updated">${escapeHtml(chrome.updatedLabel)}: ${escapeHtml(chrome.formatDate(LEGAL_UPDATED))}</p>
<p>${inline(doc.intro, email)}</p>
${body}
</main>
<footer>© 2026 Zenflow · <a href="/privacy?lang=${lang}"${page === "privacy" ? ' aria-current="page"' : ""}>${escapeHtml(chrome.privacyLink)}</a> · <a href="/terms?lang=${lang}"${page === "terms" ? ' aria-current="page"' : ""}>${escapeHtml(chrome.termsLink)}</a></footer>
</body>
</html>`;
}
