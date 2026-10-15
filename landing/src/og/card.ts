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
  '<svg xmlns="http://www.w3.org/2000/svg" width="260" height="260" viewBox="0 0 260 260" fill="none"><circle cx="130" cy="130" r="130" fill="url(#g)"/><path d="M220.5 51.5C220.5 51.5 172.668 65.7587 147.635 89.6235C122.602 113.488 136.249 158.201 104.912 183.517C80.2542 203.436 33 199.5 33 199.5" stroke="#E8895E" stroke-width="24" stroke-linecap="round"/><defs><linearGradient id="g" x1="48.5" y1="31.5" x2="222.5" y2="220.5" gradientUnits="userSpaceOnUse"><stop stop-color="#2F4858"/><stop offset=".45" stop-color="#2F4858"/><stop offset="1" stop-color="#5B88A6"/></linearGradient></defs></svg>',
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
      color: "#22333d",
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
      color: "#22333d",
      backgroundColor: "#FBF5EC",
      backgroundImage:
        "radial-gradient(circle at 85% 40%, rgba(47,72,88,0.35), rgba(47,72,88,0) 45%), radial-gradient(circle at 0% 100%, rgba(232,137,94,0.45), rgba(232,137,94,0) 40%)",
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
          backgroundImage: "linear-gradient(90deg, #2F4858, #5B88A6)",
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
        border: "2px solid #ebe2d3",
        fontSize: 26,
        fontWeight: 600,
        color: "#2F4858",
      },
      h("div", { width: 14, height: 14, borderRadius: 7, background: "#E8895E" }),
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
        border: "10px solid #22333d",
        borderRadius: 48,
        background: "#FBF5EC",
        transform: "rotate(5deg)",
        boxShadow: "0 40px 70px -20px rgba(47,72,88,0.45)",
        padding: "40px 14px 0",
      },
      h(
        "div",
        { display: "flex", justifyContent: "space-between", alignItems: "baseline", margin: "0 6px 12px" },
        h("div", { fontSize: 24, fontWeight: 800 }, c.demo.day),
        h("div", { fontSize: 14, fontWeight: 600, color: "#2F4858" }, c.demo.today),
      ),
      h(
        "div",
        { position: "relative", display: "flex", flexGrow: 1, borderTop: "1px solid #ebe2d3" },
        block(fixed[0].title, "#5B88A6", 10, 70),
        block(fixed[1].title, "#5B88A6", 92, 70),
        block(c.demo.tasks[0].title, "#2F4858", 174, 52, true),
        block(fixed[2].title, "#2E7D7A", 240, 70),
        block(fixed[3].title, "#D9A23E", 324, 44),
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
