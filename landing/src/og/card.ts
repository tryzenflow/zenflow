import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import satori from "satori";
import type { Copy } from "../content/copy";

type Node = { type: string; props: Record<string, unknown> & { style?: Record<string, unknown> } };
const h = (type: string, style: Record<string, unknown>, ...children: (Node | string)[]): Node => ({
  type,
  props: { style, children },
});

const FONT_DIR = join(process.cwd(), "src", "og", "fonts");
const LOGO = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="260" height="260" viewBox="0 0 260 260" fill="none"><circle cx="130" cy="130" r="130" fill="url(#g)"/><path d="M220.5 51.5C220.5 51.5 172.668 65.7587 147.635 89.6235C122.602 113.488 136.249 158.201 104.912 183.517C80.2542 203.436 33 199.5 33 199.5" stroke="#FFD66B" stroke-width="24" stroke-linecap="round"/><defs><linearGradient id="g" x1="48.5" y1="31.5" x2="222.5" y2="220.5" gradientUnits="userSpaceOnUse"><stop stop-color="#4652D6"/><stop offset=".45" stop-color="#6C7BF7"/><stop offset="1" stop-color="#5AB2FF"/></linearGradient></defs></svg>',
)}`;

const block = (title: string, color: string, top: number, height: number, glow = false): Node =>
  h(
    "div",
    {
      position: "absolute",
      left: 10,
      right: 10,
      top,
      height,
      display: "flex",
      padding: "8px 12px",
      borderRadius: 14,
      borderLeft: `5px solid ${color}`,
      background: `${color}2e`,
      fontSize: 17,
      fontWeight: 600,
      color: "#1d1e2c",
      boxShadow: glow ? `0 10px 24px -8px ${color}` : "none",
    },
    title,
  );

/** 1200x630 share card for link previews (PNG: Zalo, Messenger and X ignore SVG). */
export async function renderShareCard(c: Copy): Promise<Uint8Array> {
  const [regular, semibold, extrabold] = await Promise.all(
    ["Geist-Regular.ttf", "Geist-SemiBold.ttf", "Geist-ExtraBold.ttf"].map((f) => readFile(join(FONT_DIR, f))),
  );
  const fixed = c.demo.fixed;
  const tree = h(
    "div",
    {
      width: 1200,
      height: 630,
      display: "flex",
      position: "relative",
      fontFamily: "Geist",
      color: "#1d1e2c",
      backgroundColor: "#FBFAF7",
      backgroundImage:
        "radial-gradient(circle at 85% 40%, rgba(108,123,247,0.35), rgba(108,123,247,0) 45%), radial-gradient(circle at 0% 100%, rgba(255,214,107,0.45), rgba(255,214,107,0) 40%)",
    },
    h(
      "div",
      { position: "absolute", left: 72, top: 72, width: 640, display: "flex", flexDirection: "column" },
      h(
        "div",
        { display: "flex", alignItems: "center", gap: 18, fontSize: 40, fontWeight: 800, letterSpacing: -1, marginBottom: 44 },
        { type: "img", props: { src: LOGO, width: 64, height: 64 } },
        "Zenflow",
      ),
      h("div", { display: "flex", fontSize: 70, fontWeight: 800, lineHeight: 1.04, letterSpacing: -2.5 }, c.headline),
      h(
        "div",
        {
          display: "flex",
          fontSize: 70,
          fontWeight: 800,
          lineHeight: 1.04,
          letterSpacing: -2.5,
          backgroundImage: "linear-gradient(90deg, #4652D6, #5AB2FF)",
          backgroundClip: "text",
          color: "transparent",
        },
        c.accent,
      ),
    ),
    h(
      "div",
      {
        position: "absolute",
        left: 72,
        bottom: 64,
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 24px",
        borderRadius: 99,
        background: "#ffffff",
        border: "2px solid #e9e7f0",
        fontSize: 26,
        fontWeight: 600,
        color: "#4652D6",
      },
      h("div", { width: 14, height: 14, borderRadius: 7, background: "#FFD66B" }),
      c.badge,
    ),
    h(
      "div",
      {
        position: "absolute",
        right: 86,
        top: 56,
        width: 300,
        height: 620,
        display: "flex",
        flexDirection: "column",
        border: "10px solid #1d1e2c",
        borderRadius: 48,
        background: "#FBFAF7",
        transform: "rotate(5deg)",
        boxShadow: "0 40px 70px -20px rgba(70,82,214,0.45)",
        padding: "40px 14px 0",
      },
      h(
        "div",
        { display: "flex", justifyContent: "space-between", alignItems: "baseline", margin: "0 6px 12px" },
        h("div", { fontSize: 24, fontWeight: 800 }, c.demo.day),
        h("div", { fontSize: 14, fontWeight: 600, color: "#4652D6" }, c.demo.today),
      ),
      h(
        "div",
        { position: "relative", display: "flex", flexGrow: 1, borderTop: "1px solid #e9e7f0" },
        block(fixed[0].title, "#5AB2FF", 10, 70),
        block(fixed[1].title, "#5AB2FF", 92, 70),
        block(c.demo.tasks[0].title, "#6C7BF7", 174, 52, true),
        block(fixed[2].title, "#FF6F91", 240, 70),
        block(fixed[3].title, "#FFB547", 324, 44),
      ),
    ),
  );

  const svg = await satori(tree as unknown as Parameters<typeof satori>[0], {
    width: 1200,
    height: 630,
    fonts: [
      { name: "Geist", data: regular, weight: 400, style: "normal" },
      { name: "Geist", data: semibold, weight: 600, style: "normal" },
      { name: "Geist", data: extrabold, weight: 800, style: "normal" },
    ],
  });
  return new Resvg(svg, { fitTo: { mode: "width", value: 1200 } }).render().asPng();
}
