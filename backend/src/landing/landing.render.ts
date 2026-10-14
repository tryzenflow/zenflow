import { existsSync } from "node:fs";
import { join } from "node:path";
import { FAVICON, LOGO, escapeHtml } from "../legal/legal.render";
import type { LegalLang } from "../legal/legal.types";
import {
  LANDING,
  type LandingCopy,
  type LandingIcon,
  SHOTS as ALL_SHOTS,
} from "./landing.content";

/** Only the screenshots that exist on disk, so a missing file never renders a broken image. */
const SHOTS = ALL_SHOTS.filter((s) =>
  existsSync(join(__dirname, "assets", s.file)),
);

const ICONS: Record<LandingIcon | "download" | "check", string> = {
  calendar:
    '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  sparkles:
    '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 3v4M17 5h4"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  "wifi-off":
    '<path d="M12 20h.01M8.5 16.4a5 5 0 0 1 7 0M2 8.8a15 15 0 0 1 4.2-2.6M22 8.8a15 15 0 0 0-8.1-3.7M5 12.9a10 10 0 0 1 5.2-2.7M19 12.9a10 10 0 0 0-2.4-1.9M2 2l20 20"/>',
  globe:
    '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  trending: '<path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>',
  graduation:
    '<path d="M22 10L12 5 2 10l10 5 10-5z"/><path d="M6 12v5c3 2 9 2 12 0v-5"/>',
  download: '<path d="M12 3v12m0 0l-4-4m4 4l4-4M4 21h16"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
};

function icon(name: keyof typeof ICONS, size = 22): string {
  return `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

const FONTS = [
  { file: "Geist-Regular.ttf", weight: 400 },
  { file: "Geist-SemiBold.ttf", weight: 600 },
  { file: "Geist-ExtraBold.ttf", weight: 800 },
];

const FONT_FACES = FONTS.map(
  (f) =>
    `@font-face{font-family:"Geist";font-weight:${f.weight};font-style:normal;font-display:swap;src:url(/landing/fonts/${f.file}) format("truetype")}`,
).join("");

const STYLE = `${FONT_FACES}
:root{color-scheme:light dark;--bg:#fffaf4;--fg:#1c1814;--muted:#6f655a;--card:#fff;--rule:#efe5d9;--primary:#ff7a1a;--on-primary:#2b1406;--accent:#c2540a;--glow:rgba(255,122,26,.20);--shadow:0 30px 60px -20px rgba(120,60,10,.35)}
@media (prefers-color-scheme:dark){:root{--bg:#0f0d0a;--fg:#f6f2ec;--muted:#aca295;--card:#1a1612;--rule:#2c2721;--primary:#ff8e3e;--accent:#ff9a52;--glow:rgba(255,122,26,.16);--shadow:0 30px 60px -20px rgba(0,0,0,.8)}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--fg);font:17px/1.6 "Geist",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
a{color:inherit}
.sun{height:4px;background:linear-gradient(90deg,#ff6900,#f0b100 55%,#d8f999)}
.wrap{position:relative;max-width:1080px;margin:0 auto;padding:0 20px}
.nav{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-top:20px}
.brand{display:flex;align-items:center;gap:10px;text-decoration:none;font-weight:800;font-size:20px;letter-spacing:-.02em}
.navr{display:flex;align-items:center;gap:10px}
.lang{display:inline-flex;gap:2px;padding:3px;border:1px solid var(--rule);border-radius:999px;background:var(--card)}
.lang a{min-width:40px;padding:5px 10px;border-radius:999px;text-align:center;font-size:13px;font-weight:600;color:var(--muted);text-decoration:none}
.lang a[aria-current]{background:var(--fg);color:var(--bg)}
.btn{display:inline-flex;align-items:center;gap:10px;padding:14px 26px;border-radius:999px;background:linear-gradient(135deg,#ff6900,#ff8e3e 55%,#f0b100);color:var(--on-primary);font-weight:800;font-size:17px;text-decoration:none;box-shadow:0 10px 30px -8px rgba(255,105,0,.55);transition:transform .15s,box-shadow .15s}
.btn:hover{transform:translateY(-2px);box-shadow:0 16px 36px -8px rgba(255,105,0,.65)}
.btn:focus-visible,a:focus-visible,summary:focus-visible{outline:3px solid var(--fg);outline-offset:3px}
.btn.sm{padding:9px 16px;font-size:14px;box-shadow:none}
.ghost{display:inline-flex;align-items:center;padding:14px 8px;font-weight:600;color:var(--muted);text-decoration:none}
.ghost:hover{color:var(--fg)}
.page{position:relative;overflow:hidden}
.page::before{content:"";position:absolute;inset:0 0 auto;height:780px;background:radial-gradient(50% 55% at 50% 30%,var(--glow),transparent 70%),radial-gradient(30% 35% at 78% 40%,rgba(240,177,0,.14),transparent 70%);pointer-events:none}
.hero{display:grid;gap:44px;align-items:center;padding:52px 0 56px}
.badge{display:inline-flex;align-items:center;gap:8px;padding:6px 14px 6px 10px;border:1px solid var(--rule);border-radius:999px;background:var(--card);color:var(--accent);font-size:14px;font-weight:600}
h1{margin:18px 0 18px;font-size:clamp(40px,9vw,76px);line-height:1.02;letter-spacing:-.04em;font-weight:800;text-wrap:balance}
h1 em{font-style:normal;background:linear-gradient(90deg,#ff6900,#f0b100);-webkit-background-clip:text;background-clip:text;color:transparent}
.lead{margin:0 0 28px;max-width:34em;color:var(--muted);font-size:clamp(17px,2.4vw,20px);text-wrap:pretty}
.cta{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px}
.note{margin:14px 0 0;color:var(--muted);font-size:14.5px}
.syncs{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:26px;color:var(--muted);font-size:14px}
.syncs span.pill{display:inline-flex;align-items:center;gap:6px;padding:5px 12px;border:1px solid var(--rule);border-radius:999px;background:var(--card);color:var(--fg);font-weight:600;font-size:13.5px}
.stage{position:relative;display:flex;justify-content:center;padding:10px 0}
.phone{position:relative;width:min(290px,72vw);aspect-ratio:9/18.6;border:9px solid #1c1814;border-radius:44px;background:var(--bg);box-shadow:var(--shadow);overflow:hidden;transform:rotate(-2.5deg)}
.phone::before{content:"";position:absolute;top:8px;left:50%;width:70px;height:18px;margin-left:-35px;border-radius:99px;background:#1c1814;z-index:3}
.scr{position:absolute;inset:0;padding:34px 12px 12px;font-size:11px;line-height:1.3}
.sbar{display:flex;justify-content:space-between;font-weight:600;font-size:10px;margin-bottom:8px;padding:0 4px}
.dh{display:flex;align-items:baseline;justify-content:space-between;margin:0 4px 8px}
.dh b{font-size:18px;letter-spacing:-.02em}
.dh span{color:var(--primary);font-weight:600;font-size:11px}
.week{display:grid;grid-template-columns:repeat(7,1fr);gap:3px;margin-bottom:10px;text-align:center;color:var(--muted);font-size:9.5px}
.week i{display:block;font-style:normal;margin:2px auto 0;width:24px;height:24px;line-height:24px;border-radius:50%;color:var(--fg);font-weight:600;font-size:11px}
.week i.on{background:var(--primary);color:var(--on-primary)}
.grid{position:relative;height:calc(100% - 92px);border-top:1px solid var(--rule)}
.grid::before{content:"";position:absolute;inset:0;background:repeating-linear-gradient(to bottom,transparent 0 31px,var(--rule) 31px 32px)}
.ev{position:absolute;left:30px;right:6px;border-radius:10px;padding:6px 8px;font-weight:600;font-size:10.5px;overflow:hidden}
.ev small{display:block;font-weight:400;opacity:.75;font-size:9.5px}
.ev.l{background:#dbe6ff;color:#1f3a8a}
.ev.x{background:#ffdcdc;color:#8a1f1f}
.ev.t{background:linear-gradient(135deg,#ff8e3e,#f0b100);color:#2b1406;box-shadow:0 6px 14px -4px rgba(255,105,0,.6)}
@media (prefers-color-scheme:dark){.ev.l{background:#1e2a52;color:#bcd0ff}.ev.x{background:#4a1d1d;color:#ffc4c4}}
.hr{position:absolute;left:4px;font-size:9px;color:var(--muted)}
.tag{display:inline-block;margin-left:4px;padding:1px 6px;border-radius:99px;background:rgba(43,20,6,.18);font-size:9px;font-weight:800}
.chip{position:absolute;display:flex;align-items:center;gap:10px;padding:10px 14px;border:1px solid var(--rule);border-radius:16px;background:var(--card);box-shadow:var(--shadow);font-size:13px;line-height:1.3;max-width:230px;animation:float 6s ease-in-out infinite}
.chip b{display:block;font-size:13.5px}
.chip span{color:var(--muted)}
.chip .ic{display:grid;place-items:center;flex:none;width:32px;height:32px;border-radius:10px;background:rgba(255,122,26,.14);color:var(--accent)}
.chip.a{top:8%;left:-4px}
.chip.b{bottom:12%;right:-4px;animation-delay:-3s}
@keyframes float{50%{transform:translateY(-8px)}}
.rise{animation:rise .7s cubic-bezier(.2,.7,.2,1) both}
@keyframes rise{from{opacity:0;transform:translateY(16px)}}
@media (prefers-reduced-motion:reduce){.chip,.rise{animation:none}html{scroll-behavior:auto}.btn{transition:none}}
section{padding:56px 0}
h2{margin:0 0 28px;font-size:clamp(28px,5vw,44px);line-height:1.1;letter-spacing:-.03em;font-weight:800;text-wrap:balance}
.steps{display:grid;gap:16px;counter-reset:s}
.step{position:relative;padding:26px;border:1px solid var(--rule);border-radius:24px;background:var(--card)}
.step::before{counter-increment:s;content:counter(s);display:grid;place-items:center;width:38px;height:38px;margin-bottom:16px;border-radius:12px;background:linear-gradient(135deg,#ff6900,#f0b100);color:var(--on-primary);font-weight:800}
.step h3,.card h3{margin:0 0 6px;font-size:20px;letter-spacing:-.02em}
.step p,.card p{margin:0;color:var(--muted);font-size:16px}
.bento{display:grid;gap:14px}
.card{padding:24px;border:1px solid var(--rule);border-radius:24px;background:var(--card);transition:transform .2s,border-color .2s}
.card:hover{transform:translateY(-3px);border-color:var(--primary)}
.card .ib{display:grid;place-items:center;width:44px;height:44px;margin-bottom:14px;border-radius:14px;background:rgba(255,122,26,.12);color:var(--accent)}
.card:first-child{background:linear-gradient(160deg,var(--card),rgba(255,122,26,.10))}
.shots{display:flex;gap:16px;overflow-x:auto;padding:4px 2px 14px;scroll-snap-type:x mandatory}
.shots img{flex:none;width:min(250px,64vw);height:auto;border:1px solid var(--rule);border-radius:24px;box-shadow:var(--shadow);scroll-snap-align:start}
.install{display:grid;gap:28px;align-items:center;padding:34px;border:1px solid var(--rule);border-radius:32px;background:linear-gradient(160deg,var(--card),rgba(255,122,26,.08))}
.install ol{margin:0 0 14px;padding:0;list-style:none;counter-reset:i}
.install li{position:relative;margin-bottom:12px;padding-left:44px}
.install li::before{counter-increment:i;content:counter(i);position:absolute;left:0;top:0;display:grid;place-items:center;width:30px;height:30px;border-radius:50%;background:var(--fg);color:var(--bg);font-weight:800;font-size:14px}
.install .fine{color:var(--muted);font-size:14.5px;margin:0}
details{border-bottom:1px solid var(--rule)}
summary{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:20px 2px;font-weight:600;font-size:18px;cursor:pointer;list-style:none}
summary::-webkit-details-marker{display:none}
summary::after{content:"+";flex:none;font-size:26px;font-weight:400;color:var(--accent);transition:transform .2s}
details[open] summary::after{transform:rotate(45deg)}
details p{margin:0 0 20px;max-width:46em;color:var(--muted)}
.final{margin:20px 0 56px;padding:56px 24px;border-radius:36px;text-align:center;background:radial-gradient(70% 120% at 50% 0%,rgba(255,200,80,.55),transparent 70%),linear-gradient(135deg,#ff6900,#ff8e3e 60%,#f0b100);color:#2b1406}
.final h2{margin-bottom:8px;color:#2b1406}
.final p{margin:0 0 24px;font-size:20px;font-weight:600}
.final .btn{background:#2b1406;color:#fff;box-shadow:0 14px 30px -10px rgba(0,0,0,.5)}
footer{display:flex;flex-wrap:wrap;gap:8px 22px;padding:22px 0 40px;border-top:1px solid var(--rule);color:var(--muted);font-size:14.5px}
footer a{color:var(--muted)}
@media (max-width:599px){.navr .btn{display:none}}
@media (min-width:760px){
.steps{grid-template-columns:repeat(3,1fr)}
.bento{grid-template-columns:repeat(6,1fr)}
.card{grid-column:span 2}
.card:nth-child(1){grid-column:span 4}
.card:nth-child(6),.card:nth-child(7){grid-column:span 3}
.install{grid-template-columns:1.1fr .9fr;padding:48px}
}
@media (min-width:920px){
.hero{grid-template-columns:1.1fr .9fr;padding:72px 0 80px}
.chip.a{left:-12px}.chip.b{right:-12px}
}
`;

function phone(c: LandingCopy): string {
  const m = c.mock;
  const days = [
    ["M", 13],
    ["T", 14],
    ["W", 15],
    ["T", 16],
    ["F", 17],
    ["S", 18],
    ["S", 19],
  ] as const;
  const week = days
    .map(
      ([d, n]) => `<div>${d}<i${n === 14 ? ' class="on"' : ""}>${n}</i></div>`,
    )
    .join("");
  const hours = ["08", "09", "10", "11", "12", "13", "14", "15"]
    .map((h, i) => `<span class="hr" style="top:${i * 32 + 2}px">${h}</span>`)
    .join("");
  return `<div class="phone" role="img" aria-label="${escapeHtml(m.label)}"><div class="scr" aria-hidden="true">
<div class="sbar"><span>9:41</span><span>100%</span></div>
<div class="dh"><b>${escapeHtml(m.day)}</b><span>${escapeHtml(m.today)}</span></div>
<div class="week">${week}</div>
<div class="grid">${hours}
<div class="ev l" style="top:8px;height:58px">${escapeHtml(m.lecture)}<small>08:00</small></div>
<div class="ev l" style="top:104px;height:52px">${escapeHtml(m.lab)}<small>11:00</small></div>
<div class="ev t" style="top:164px;height:46px">${escapeHtml(m.task)}<span class="tag">${escapeHtml(m.auto)}</span><small>13:15</small></div>
<div class="ev x" style="top:222px;height:30px">${escapeHtml(m.exam)}</div>
</div></div></div>`;
}

/**
 * `baseUrl` (the public origin) turns on the absolute tags (canonical, hreflang
 * alternates, og:url, og:image); without it they are left out.
 */
export function renderLandingPage(
  lang: LegalLang,
  apkUrl: string,
  baseUrl?: string,
): string {
  const c = LANDING[lang];
  const other: LegalLang = lang === "en" ? "vi" : "en";
  const origin = baseUrl?.replace(/\/+$/, "");
  const abs = (l: LegalLang) => `${origin}/?lang=${l}`;
  const asset = (file: string) => `${origin ?? ""}/landing/${file}`;
  const shareImage = asset(`og-${lang}.png`);
  const shareAlt = `${c.shareTitle}. ${c.headline} ${c.accent}`;

  const absoluteTags = origin
    ? [
        `<link rel="canonical" href="${escapeHtml(abs(lang))}">`,
        `<link rel="alternate" hreflang="${lang}" href="${escapeHtml(abs(lang))}">`,
        `<link rel="alternate" hreflang="${other}" href="${escapeHtml(abs(other))}">`,
        `<link rel="alternate" hreflang="x-default" href="${escapeHtml(`${origin}/`)}">`,
        `<meta property="og:url" content="${escapeHtml(abs(lang))}">`,
      ].join("\n")
    : "";

  const jsonLd = JSON.stringify([
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "Zenflow",
      inLanguage: c.htmlLang,
      ...(origin ? { url: origin } : {}),
    },
    {
      "@context": "https://schema.org",
      "@type": "MobileApplication",
      name: "Zenflow",
      operatingSystem: "Android",
      applicationCategory: "EducationApplication",
      description: c.description,
      inLanguage: c.htmlLang,
      downloadUrl: apkUrl,
      image: shareImage,
      offers: { "@type": "Offer", price: "0", priceCurrency: "VND" },
      ...(SHOTS.length ? { screenshot: SHOTS.map((s) => asset(s.file)) } : {}),
      ...(origin ? { url: origin } : {}),
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: c.faq.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    },
  ]).replaceAll("<", "\\u003c");

  const langLink = (l: LegalLang) =>
    `<a href="/?lang=${l}" hreflang="${l}" lang="${l}"${l === lang ? ' aria-current="true"' : ""} aria-label="${escapeHtml(LANDING[l].languageName)}">${LANDING[l].languageShort}</a>`;

  const how = c.how
    .map(
      (s) =>
        `<div class="step"><h3>${escapeHtml(s.title)}</h3><p>${escapeHtml(s.body)}</p></div>`,
    )
    .join("");

  const features = c.features
    .map((f) => {
      return `<div class="card"><div class="ib">${icon(f.icon)}</div><h3>${escapeHtml(f.title)}</h3><p>${escapeHtml(f.body)}</p></div>`;
    })
    .join("");

  const shots = SHOTS.length
    ? `<section><h2>${escapeHtml(c.shotsLabel)}</h2><div class="shots">${SHOTS.map(
        (s) =>
          `<img src="/landing/${escapeHtml(s.file)}" alt="${escapeHtml(s.alt[lang])}" width="480" height="1040" loading="lazy">`,
      ).join("")}</div></section>`
    : "";

  const faq = c.faq
    .map(
      (f) =>
        `<details><summary>${escapeHtml(f.q)}</summary><p>${escapeHtml(f.a)}</p></details>`,
    )
    .join("");

  const download = (cls = "btn") =>
    `<a class="${cls}" href="${escapeHtml(apkUrl)}" rel="noopener">${icon("download", 20)}${escapeHtml(c.download)}</a>`;

  return `<!doctype html>
<html lang="${c.htmlLang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(c.title)}</title>
<meta name="description" content="${escapeHtml(c.description)}">
<meta name="robots" content="index,follow,max-image-preview:large">
<meta name="application-name" content="Zenflow">
<meta name="apple-mobile-web-app-title" content="Zenflow">
<meta name="format-detection" content="telephone=no">
<meta name="theme-color" content="#fffaf4" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0f0d0a" media="(prefers-color-scheme: dark)">
<link rel="icon" type="image/svg+xml" href="${escapeHtml(FAVICON)}">
<link rel="icon" type="image/png" sizes="32x32" href="/landing/icon-32.png">
<link rel="apple-touch-icon" sizes="180x180" href="/landing/icon-180.png">
<link rel="preload" href="/landing/fonts/Geist-ExtraBold.ttf" as="font" type="font/ttf" crossorigin>
<link rel="preload" href="/landing/fonts/Geist-Regular.ttf" as="font" type="font/ttf" crossorigin>
<meta property="og:type" content="website">
<meta property="og:site_name" content="Zenflow">
<meta property="og:title" content="${escapeHtml(c.title)}">
<meta property="og:description" content="${escapeHtml(c.description)}">
<meta property="og:locale" content="${lang === "vi" ? "vi_VN" : "en_US"}">
<meta property="og:locale:alternate" content="${other === "vi" ? "vi_VN" : "en_US"}">
<meta property="og:image" content="${escapeHtml(shareImage)}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${escapeHtml(shareAlt)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(c.title)}">
<meta name="twitter:description" content="${escapeHtml(c.description)}">
<meta name="twitter:image" content="${escapeHtml(shareImage)}">
<meta name="twitter:image:alt" content="${escapeHtml(shareAlt)}">
${absoluteTags}
<script type="application/ld+json">${jsonLd}</script>
<style>${STYLE}</style>
</head>
<body>
<div class="sun"></div>
<div class="page">
<div class="wrap">
<header class="nav">
<a class="brand" href="/?lang=${lang}">${LOGO}<span>Zenflow</span></a>
<div class="navr">
<nav class="lang" aria-label="Language">${langLink("en")}${langLink("vi")}</nav>
${download("btn sm")}
</div>
</header>
<main>
<div class="hero">
<div class="rise">
<span class="badge">${icon("graduation", 16)}${escapeHtml(c.badge)}</span>
<h1>${escapeHtml(c.headline)} <em>${escapeHtml(c.accent)}</em></h1>
<p class="lead">${escapeHtml(c.lead)}</p>
<div class="cta">${download()}<a class="ghost" href="#how">${escapeHtml(c.howLink)}</a></div>
<p class="note">${escapeHtml(c.downloadNote)}</p>
<div class="syncs"><span>${escapeHtml(c.syncsFrom)}</span>${c.sources.map((s) => `<span class="pill">${escapeHtml(s)}</span>`).join("")}</div>
</div>
<div class="stage rise" style="animation-delay:.12s">
${phone(c)}
<div class="chip a"><div class="ic">${icon("bell", 18)}</div><div><b>${escapeHtml(c.mock.chipTitle)}</b><span>${escapeHtml(c.mock.chipBody)}</span></div></div>
<div class="chip b"><div class="ic">${icon("sparkles", 18)}</div><div><b>${escapeHtml(c.mock.placedTitle)}</b><span>${escapeHtml(c.mock.placedBody)}</span></div></div>
</div>
</div>
<section id="how"><h2>${escapeHtml(c.howLabel)}</h2><div class="steps">${how}</div></section>
<section><h2>${escapeHtml(c.featuresLabel)}</h2><div class="bento">${features}</div></section>
${shots}
<section id="install"><div class="install">
<div><h2>${escapeHtml(c.stepsLabel)}</h2><ol>${c.steps.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ol><p class="fine">${escapeHtml(c.installNote)}</p></div>
<div>${download()}</div>
</div></section>
<section><h2>${escapeHtml(c.faqLabel)}</h2>${faq}</section>
<div class="final"><h2>${escapeHtml(c.finalTitle)}</h2><p>${escapeHtml(c.finalBody)}</p>${download()}</div>
</main>
<footer>
<span>&copy; ${new Date().getUTCFullYear()} Zenflow. ${escapeHtml(c.rightsReserved)}</span>
<a href="/privacy?lang=${lang}">${escapeHtml(c.privacyLink)}</a>
<a href="/terms?lang=${lang}">${escapeHtml(c.termsLink)}</a>
</footer>
</div>
</div>
</body>
</html>`;
}
