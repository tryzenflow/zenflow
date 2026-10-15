import type { SessionCardState, SessionType } from "@zenflow/shared";

/**
 * Sand and slate palette. Hex source of truth for code that paints with raw
 * colours (RN style props, SVG, WebView CSS). The Tailwind tokens in
 * `mobile/app/global.css`, `frontend/src/index.css` and
 * `landing/src/styles/global.css` carry the same values;
 * `mobile/lib/__tests__/palette.test.ts` keeps them in sync and checks AA.
 *
 * Brand: sand background, clay sun accent, slate primary, soft grey. Warm
 * neutrals, steel and teal blues, honey and sage come from the same family.
 * Cherry is the only red and marks late and overdue work only.
 */
export const BRAND = {
  /** Light background. Never text on it below AA. */
  sand: "#FBF5EC",
  /** Sun accent, clay. Highlights and the conflict tone. */
  sun: "#E8895E",
  /** Primary, slate. Primary fills and brand marks. */
  slate: "#2F4858",
  /** Soft grey. Dnd and quiet strokes. */
  grey: "#B0B8BA",
  /** Dark background. */
  deepSlate: "#16232B",
} as const;

export type Scheme = "light" | "dark";

/** Sage: success and done. Fill only, not text on sand. */
export const SUCCESS = "#7DA886";

/**
 * UI neutrals and roles per scheme. Each key is a CSS variable: `background`,
 * `foreground`, `card`, `muted`, `muted-foreground`, `border`, `primary`,
 * `primary-foreground`, `ring`, `destructive`, `destructive-foreground`,
 * `glass`, `glass-edge` and `success`. `brand-slate` mirrors `primary`.
 */
export interface UiTokens {
  /** Page. */
  background: string;
  /** Body text, AA or better on `background` and `card`. */
  foreground: string;
  /** Elevated surface: cards, popovers, sheets. */
  card: string;
  /** Secondary, accent and muted fills. */
  muted: string;
  /** Secondary text, AA on `background`, `card` and `muted`. */
  mutedForeground: string;
  /** Hairlines, inputs and scrollbars. */
  border: string;
  /** Primary fill: solid buttons and selection. */
  primary: string;
  /** Text on `primary`, AA. */
  primaryForeground: string;
  /** Focus ring, same as `primary`. */
  ring: string;
  /** Destructive fill. Slate, never red, so cherry stays reserved. */
  destructive: string;
  /** Text on `destructive`, AA. */
  destructiveForeground: string;
  /** Frosted glass fill. */
  glass: string;
  /** Glass edge and glow. */
  glassEdge: string;
  /** Success fill, same as `SUCCESS`. */
  success: string;
}

export const UI: Record<Scheme, UiTokens> = {
  light: {
    background: BRAND.sand,
    foreground: "#22333D",
    card: "#FFFCF7",
    muted: "#F2EADC",
    mutedForeground: "#5C6B72",
    border: "#E6DCCB",
    primary: BRAND.slate,
    primaryForeground: BRAND.sand,
    ring: BRAND.slate,
    destructive: "#3A4A55",
    destructiveForeground: "#FFFCF7",
    glass: "#FFFCF7",
    glassEdge: BRAND.slate,
    success: SUCCESS,
  },
  dark: {
    background: BRAND.deepSlate,
    foreground: "#F3ECDF",
    card: "#1F303A",
    muted: "#263A45",
    mutedForeground: "#A8B4B8",
    border: "#2D4048",
    /** Pale slate, so solid buttons read on the dark page. */
    primary: "#C9D6DB",
    primaryForeground: BRAND.deepSlate,
    ring: "#C9D6DB",
    destructive: "#E6DED0",
    destructiveForeground: BRAND.deepSlate,
    glass: "#F3ECDF",
    glassEdge: "#9FB4BE",
    success: SUCCESS,
  },
};

/** Page and card surfaces a session block can sit on. */
export const SURFACES: Record<Scheme, { background: string; card: string }> = {
  light: { background: UI.light.background, card: UI.light.card },
  dark: { background: UI.dark.background, card: UI.dark.card },
};

/**
 * Colour roles for session blocks. `base` is the stripe, dot and tint source.
 * `ink` is the text on the 12% (light) or 22% (dark) tint, AA on both page and
 * card. `late` (cherry) is the only red and marks late and overdue work only.
 * `conflict` reuses the sun accent.
 */
export type SessionTone =
  | "lecture"
  | "exam"
  | "assignment"
  | "task"
  | "dnd"
  | "done"
  | "late"
  | "conflict";

export interface SessionToneColors {
  /** Stripe, dot and tint source. */
  base: string;
  /** Text on the tint, AA (4.5:1) per scheme. */
  ink: Record<Scheme, string>;
}

export const SESSION_TONES: Record<SessionTone, SessionToneColors> = {
  /** Steel blue. */
  lecture: { base: "#5B88A6", ink: { light: "#476B83", dark: "#99B1BD" } },
  /** Teal. */
  exam: { base: "#2E7D7A", ink: { light: "#2A6F6E", dark: "#89B0A8" } },
  /** Honey. */
  assignment: { base: "#D9A23E", ink: { light: "#7E6735", dark: "#DEB15E" } },
  /** Slate, lifted from primary so the stripe shows on deep slate. */
  task: { base: "#47687C", ink: { light: "#47687C", dark: "#9AA7AC" } },
  /** Soft grey. */
  dnd: { base: BRAND.grey, ink: { light: "#626C72", dark: "#B8BFBF" } },
  /** Sage, the success colour. */
  done: { base: SUCCESS, ink: { light: "#516F5F", dark: "#A1BDA1" } },
  /** Cherry, the only red. */
  late: { base: "#D6334A", ink: { light: "#B83045", dark: "#E3888F" } },
  /** Sun clay. */
  conflict: { base: BRAND.sun, ink: { light: "#8E5D48", dark: "#EBA481" } },
};

/** Block fill alpha over the surface: 12% light, 22% dark. */
export const SESSION_TINT_ALPHA: Record<Scheme, number> = {
  light: 0.12,
  dark: 0.22,
};

/** Block stripe width in px. */
export const SESSION_STRIPE_WIDTH = 3;

export const SESSION_TYPE_TONE: Record<SessionType, SessionTone> = {
  TASK: "task",
  ASSIGNMENT: "assignment",
  EXAM: "exam",
  LECTURE: "lecture",
  DND: "dnd",
};

const STATE_TONE: Record<SessionCardState, SessionTone> = {
  fluid: "task",
  conflict: "conflict",
  assignment: "assignment",
  exam: "exam",
  lecture: "lecture",
  dnd: "dnd",
};

/** Tone for a card; late wins over the state. */
export function sessionTone(state: SessionCardState, late = false): SessionTone {
  return late ? "late" : STATE_TONE[state];
}

/**
 * Tailwind classes per tone, spelled out so the class scanners see them.
 * `tint` is the block fill, `stripe` the 3px left border, `text` the AA ink.
 */
export const SESSION_TONE_CLASSES: Record<
  SessionTone,
  { tint: string; stripe: string; text: string; dot: string; badge: string }
> = {
  lecture: {
    tint: "bg-session-lecture/[0.12] dark:bg-session-lecture/[0.22]",
    stripe: "border-l-[3px] border-l-session-lecture",
    text: "text-session-lecture-ink",
    dot: "bg-session-lecture",
    badge: "border-session-lecture/40 bg-session-lecture/[0.12] dark:bg-session-lecture/[0.22]",
  },
  exam: {
    tint: "bg-session-exam/[0.12] dark:bg-session-exam/[0.22]",
    stripe: "border-l-[3px] border-l-session-exam",
    text: "text-session-exam-ink",
    dot: "bg-session-exam",
    badge: "border-session-exam/40 bg-session-exam/[0.12] dark:bg-session-exam/[0.22]",
  },
  assignment: {
    tint: "bg-session-assignment/[0.12] dark:bg-session-assignment/[0.22]",
    stripe: "border-l-[3px] border-l-session-assignment",
    text: "text-session-assignment-ink",
    dot: "bg-session-assignment",
    badge:
      "border-session-assignment/40 bg-session-assignment/[0.12] dark:bg-session-assignment/[0.22]",
  },
  task: {
    tint: "bg-session-task/[0.12] dark:bg-session-task/[0.22]",
    stripe: "border-l-[3px] border-l-session-task",
    text: "text-session-task-ink",
    dot: "bg-session-task",
    badge: "border-session-task/40 bg-session-task/[0.12] dark:bg-session-task/[0.22]",
  },
  dnd: {
    tint: "bg-session-dnd/[0.12] dark:bg-session-dnd/[0.22]",
    stripe: "border-l-[3px] border-l-session-dnd [border-left-style:dashed]",
    text: "text-session-dnd-ink",
    dot: "bg-session-dnd",
    badge: "border-session-dnd/40 bg-session-dnd/[0.12] dark:bg-session-dnd/[0.22]",
  },
  done: {
    tint: "bg-session-done/[0.12] dark:bg-session-done/[0.22]",
    stripe: "border-l-[3px] border-l-session-done",
    text: "text-session-done-ink",
    dot: "bg-session-done",
    badge: "border-session-done/40 bg-session-done/[0.12] dark:bg-session-done/[0.22]",
  },
  late: {
    tint: "bg-session-late/[0.12] dark:bg-session-late/[0.22]",
    stripe: "border-l-[3px] border-l-session-late",
    text: "text-session-late-ink",
    dot: "bg-session-late",
    badge: "border-session-late/40 bg-session-late/[0.12] dark:bg-session-late/[0.22]",
  },
  conflict: {
    tint: "bg-session-conflict/[0.12] dark:bg-session-conflict/[0.22]",
    stripe: "border-l-[3px] border-l-session-conflict",
    text: "text-session-conflict-ink",
    dot: "bg-session-conflict",
    badge:
      "border-session-conflict/40 bg-session-conflict/[0.12] dark:bg-session-conflict/[0.22]",
  },
};

/** `#rrggbb` to `[r, g, b]`. */
export function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** `#rrggbb` plus alpha to `rgba(r, g, b, a)`. */
export function hexAlpha(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Composite `fg` at `alpha` over an opaque `bg`. */
export function mixOver(
  fg: string,
  bg: string,
  alpha: number,
): [number, number, number] {
  const f = hexToRgb(fg);
  const b = hexToRgb(bg);
  return [0, 1, 2].map((i) => f[i] * alpha + b[i] * (1 - alpha)) as [
    number,
    number,
    number,
  ];
}

function luminance([r, g, b]: [number, number, number]): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 2 contrast ratio between two colours (hex or rgb triples). */
export function contrastRatio(
  a: string | [number, number, number],
  b: string | [number, number, number],
): number {
  const la = luminance(typeof a === "string" ? hexToRgb(a) : a);
  const lb = luminance(typeof b === "string" ? hexToRgb(b) : b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
