import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BRAND,
  SESSION_TINT_ALPHA,
  SESSION_TONES,
  SURFACES,
  UI,
  type Scheme,
  type SessionTone,
  type UiTokens,
  contrastRatio,
  hexToRgb,
  mixOver,
} from "@zenflow/core";
import { describe, expect, it } from "vitest";

const MOBILE_CSS = readFileSync(join(__dirname, "../../app/global.css"), "utf8");
const LANDING_CSS = readFileSync(
  join(__dirname, "../../../landing/src/styles/global.css"),
  "utf8",
);

const tones = Object.keys(SESSION_TONES) as SessionTone[];
const schemes: Scheme[] = ["light", "dark"];

/** `UiTokens` key to the CSS variable that carries it. */
const UI_VARS: Record<keyof UiTokens, string> = {
  background: "background",
  foreground: "foreground",
  card: "card",
  muted: "muted",
  mutedForeground: "muted-foreground",
  border: "border",
  primary: "primary",
  primaryForeground: "primary-foreground",
  ring: "ring",
  destructive: "destructive",
  destructiveForeground: "destructive-foreground",
  glass: "glass",
  glassEdge: "glass-edge",
  success: "success",
};

/** The `--name: value;` declarations inside the first block that `start` opens. */
function block(css: string, start: string): Record<string, string> {
  const from = css.indexOf(start);
  if (from < 0) throw new Error(`block not found: ${start}`);
  const body = css.slice(from, css.indexOf("}", from));
  return Object.fromEntries(
    [...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
  );
}

const mobile = {
  light: block(MOBILE_CSS, ":root {"),
  dark: block(MOBILE_CSS, ".dark:root {"),
};
const landing = {
  light: block(LANDING_CSS, ":root {\n  color-scheme"),
  dark: block(LANDING_CSS, "@media (prefers-color-scheme: dark) {\n  :root {"),
};
const landingTheme = block(LANDING_CSS, "@theme {");

const channels = (hex: string) => hexToRgb(hex).join(" ");

describe("palette tokens", () => {
  it.each(schemes)("mobile %s matches the core hex values", (scheme) => {
    const vars = mobile[scheme];
    for (const [key, name] of Object.entries(UI_VARS)) {
      expect(vars[name], name).toBe(
        channels(UI[scheme][key as keyof UiTokens]),
      );
    }
    expect(vars["brand-orange"]).toBe(channels(UI[scheme].primary));
    expect(vars["brand-yellow"]).toBe(channels(BRAND.yellow));
    expect(vars["brand-lime"]).toBe(channels(BRAND.lime));
    expect(vars.background).toBe(channels(SURFACES[scheme].background));
    expect(vars.card).toBe(channels(SURFACES[scheme].card));
    for (const tone of tones) {
      expect(vars[`session-${tone}`]).toBe(channels(SESSION_TONES[tone].base));
      expect(vars[`session-${tone}-ink`]).toBe(
        channels(SESSION_TONES[tone].ink[scheme]),
      );
    }
  });

  it.each(schemes)("landing %s matches the core hex values", (scheme) => {
    const vars = landing[scheme];
    expect(vars.bg).toBe(UI[scheme].background.toLowerCase());
    expect(vars.fg).toBe(UI[scheme].foreground.toLowerCase());
    expect(vars.muted).toBe(UI[scheme].mutedForeground.toLowerCase());
    expect(vars.card).toBe(UI[scheme].card.toLowerCase());
    expect(vars.primary).toBe(UI[scheme].primary.toLowerCase());
  });

  it("landing theme matches the brand and session tones", () => {
    expect(landingTheme["color-primary"]).toBe("var(--primary)");
    expect(landingTheme["color-accent"]).toBe(BRAND.yellow.toLowerCase());
    expect(landingTheme["color-lime"]).toBe(BRAND.lime.toLowerCase());
    for (const tone of ["lecture", "exam", "assignment", "task", "done"] as const) {
      expect(landingTheme[`color-${tone}`], tone).toBe(
        SESSION_TONES[tone].base.toLowerCase(),
      );
    }
  });
});

describe("contrast", () => {
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

  it.each(schemes)("%s text tokens pass AA", (scheme) => {
    const u = UI[scheme];
    const pairs: [string, string][] = [
      [u.foreground, u.background],
      [u.foreground, u.card],
      [u.mutedForeground, u.background],
      [u.mutedForeground, u.card],
      [u.mutedForeground, u.muted],
      [u.primaryForeground, u.primary],
      [u.destructiveForeground, u.destructive],
    ];
    for (const [fg, bg] of pairs) {
      expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
