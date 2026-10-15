// Generates the landing page's share cards (1200x630 PNG, one per language) and
// icons into src/landing/assets/. Link previews (Facebook, Messenger, Zalo, X)
// need a PNG, not SVG or HTML. Re-run after changing the landing copy or brand:
//   pnpm --filter backend landing:assets
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const out = join(here, "..", "src", "landing", "assets");
const fonts = join(out, "fonts");
const iconSource = join(root, "mobile", "assets", "images", "icon.png");

// Node strips the types: landing.content.ts only has type imports.
const { LANDING } = await import(
  pathToFileURL(join(here, "..", "src", "landing", "landing.content.ts")).href
);

const esc = (s) =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const font = (file, weight) =>
  `@font-face{font-family:"Geist";font-weight:${weight};src:url(${pathToFileURL(join(fonts, file)).href})}`;

function card(lang, iconData) {
  const c = LANDING[lang];
  const m = c.mock;
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><style>
${font("Geist-Regular.ttf", 400)}${font("Geist-SemiBold.ttf", 600)}${font("Geist-ExtraBold.ttf", 800)}
*{box-sizing:border-box;margin:0}
body{width:1200px;height:630px;overflow:hidden;font-family:"Geist",sans-serif;color:#1c1814;
background:radial-gradient(60% 90% at 85% 40%,rgba(255,122,26,.28),transparent 70%),radial-gradient(40% 60% at 0% 100%,rgba(240,177,0,.22),transparent 70%),#fffaf4;position:relative}
.bar{position:absolute;top:0;left:0;right:0;height:10px;background:linear-gradient(90deg,#E8895E,#47687C 55%,#B0B8BA)}
.l{position:absolute;left:72px;top:76px;width:640px}
.brand{display:flex;align-items:center;gap:18px;font-size:40px;font-weight:800;letter-spacing:-.02em;margin-bottom:44px}
.brand img{width:64px;height:64px;border-radius:16px}
h1{font-size:72px;line-height:1.02;letter-spacing:-.04em;font-weight:800}
h1 em{font-style:normal;background:linear-gradient(90deg,#E8895E,#47687C);-webkit-background-clip:text;color:transparent}
.badge{position:absolute;left:72px;bottom:64px;display:inline-flex;gap:12px;align-items:center;padding:12px 24px;border-radius:99px;background:#fff;border:2px solid #efe5d9;font-size:26px;font-weight:600;color:#c2540a}
.phone{position:absolute;right:86px;top:56px;width:300px;height:620px;border:10px solid #1c1814;border-radius:48px;background:#fffaf4;transform:rotate(5deg);box-shadow:0 40px 70px -20px rgba(120,60,10,.45);overflow:hidden;padding:44px 14px 0}
.dh{display:flex;justify-content:space-between;align-items:baseline;margin:0 4px 12px}
.dh b{font-size:24px}.dh span{color:#ff7a1a;font-weight:600;font-size:14px}
.g{position:relative;height:100%;border-top:1px solid #efe5d9;background:repeating-linear-gradient(to bottom,transparent 0 43px,#efe5d9 43px 44px)}
.ev{position:absolute;left:8px;right:8px;border-radius:14px;padding:9px 12px;font-weight:600;font-size:15px}
.l1{background:#dbe6ff;color:#1f3a8a}.x{background:#ffdcdc;color:#8a1f1f}
.t{background:linear-gradient(135deg,#F2B08C,#47687C);color:#16232B;box-shadow:0 8px 18px -6px rgba(232,137,94,.6)}
</style></head><body><div class="bar"></div>
<div class="l"><div class="brand"><img src="${iconData}">Zenflow</div>
<h1>${esc(c.headline)} <em>${esc(c.accent)}</em></h1></div>
<div class="badge">${esc(c.badge)}</div>
<div class="phone"><div class="dh"><b>${esc(m.day)}</b><span>${esc(m.today)}</span></div>
<div class="g"><div class="ev l1" style="top:10px;height:74px">${esc(m.lecture)}</div>
<div class="ev l1" style="top:128px;height:66px">${esc(m.lab)}</div>
<div class="ev t" style="top:216px;height:60px">${esc(m.task)}</div>
<div class="ev x" style="top:304px;height:44px">${esc(m.exam)}</div></div></div>
</body></html>`;
}

await mkdir(out, { recursive: true });
const iconData = `data:image/png;base64,${(await readFile(iconSource)).toString("base64")}`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  for (const lang of ["en", "vi"]) {
    await page.setContent(card(lang, iconData), { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: join(out, `og-${lang}.png`), type: "png" });
    console.log(`og-${lang}.png`);
  }
} finally {
  await browser.close();
}

for (const size of [32, 180, 512]) {
  await sharp(iconSource).resize(size, size).png({ compressionLevel: 9 }).toFile(join(out, `icon-${size}.png`));
  console.log(`icon-${size}.png`);
}
