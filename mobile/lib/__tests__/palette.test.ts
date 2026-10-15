import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BRAND,
  SESSION_TINT_ALPHA,
  SESSION_TONES,
  SURFACES,
  type Scheme,
  type SessionTone,
  contrastRatio,
  hexToRgb,
  mixOver,
} from "@zenflow/core";
import { describe, expect, it } from "vitest";

const MOBILE_CSS = readFileSync(join(__dirname, "../../app/global.css"), "utf8");
const WEB_CSS = readFileSync(
  join(__dirname, "../../../frontend/src/index.css"),
  "utf8",
);

const tones = Object.keys(SESSION_TONES) as SessionTone[];
const schemes: Scheme[] = ["light", "dark"];

/** The `--name: value;` declarations inside the first block that `start` opens. */
function block(css: string, start: string): Record<string, string> {
  const from = css.indexOf(start);
  const body = css.slice(from, css.indexOf("}", from));
  return Object.fromEntries(
    [...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
  );
}

const mobile = {
  light: block(MOBILE_CSS, ":root {"),
  dark: block(MOBILE_CSS, ".dark:root {"),
};
const web = {
  light: block(WEB_CSS, ":root {\n  --radius"),
  dark: block(WEB_CSS, ".dark {\n  --background"),
};

const channels = (hex: string) => hexToRgb(hex).join(" ");

describe("palette tokens", () => {
  it.each(schemes)("mobile %s matches the core hex values", (scheme) => {
    const vars = mobile[scheme];
    expect(vars.primary).toBe(channels(BRAND.slate));
    expect(vars["brand-sun"]).toBe(channels(BRAND.sun));
    expect(vars.background).toBe(channels(SURFACES[scheme].background));
    expect(vars.card).toBe(channels(SURFACES[scheme].card));
    for (const tone of tones) {
      expect(vars[`session-${tone}`]).toBe(channels(SESSION_TONES[tone].base));
      expect(vars[`session-${tone}-ink`]).toBe(
        channels(SESSION_TONES[tone].ink[scheme]),
      );
    }
  });

  it.each(schemes)("web %s matches the core hex values", (scheme) => {
    const vars = web[scheme];
    expect(vars.background).toBe(SURFACES[scheme].background.toLowerCase());
    expect(vars.card).toBe(SURFACES[scheme].card.toLowerCase());
    for (const tone of tones) {
      expect(vars[`session-${tone}-ink`]).toBe(
        SESSION_TONES[tone].ink[scheme].toLowerCase(),
      );
    }
    if (scheme === "light") {
      expect(vars["brand-slate"]).toBe(BRAND.slate.toLowerCase());
      for (const tone of tones) {
        expect(vars[`session-${tone}`]).toBe(
          SESSION_TONES[tone].base.toLowerCase(),
        );
      }
    }
  });
});

describe("session tone contrast", () => {
  const cases = tones.flatMap((tone) =>
    schemes.flatMap((scheme) =>
      (["background", "card"] as const).map((surface) => ({
        tone,
        scheme,
        surface,
      })),
    ),
  );

  it.each(cases)(
    "$tone ink passes AA on its $scheme tint over $surface",
    ({ tone, scheme, surface }) => {
      const { base, ink } = SESSION_TONES[tone];
      const tint = mixOver(
        base,
        SURFACES[scheme][surface],
        SESSION_TINT_ALPHA[scheme],
      );
      expect(contrastRatio(ink[scheme], tint)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it("primary foreground passes AA on the primary fill", () => {
    expect(contrastRatio(BRAND.deepSlate, BRAND.slate)).toBeGreaterThanOrEqual(
      4.5,
    );
  });
});
