// Prints the built JS, CSS and HTML sizes (raw and gzip) after `astro build`.
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { gzipSync } from "node:zlib";

const dist = new URL("../dist/", import.meta.url).pathname;

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

const kb = (n) => `${(n / 1024).toFixed(1)} kB`;
const rows = [];
for await (const path of walk(dist)) {
  if (!/\.(js|css|html)$/.test(path)) continue;
  const buf = await readFile(path);
  rows.push({ file: relative(dist, path), raw: buf.length, gzip: gzipSync(buf).length });
}
rows.sort((a, b) => b.gzip - a.gzip);
const js = rows.filter((r) => r.file.endsWith(".js"));
for (const r of rows) console.log(`${r.file.padEnd(48)} ${kb(r.raw).padStart(10)} ${kb(r.gzip).padStart(10)} gz`);
console.log(`${"total js".padEnd(48)} ${kb(js.reduce((s, r) => s + r.raw, 0)).padStart(10)} ${kb(js.reduce((s, r) => s + r.gzip, 0)).padStart(10)} gz`);
