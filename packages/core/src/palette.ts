import type { SessionCardState, SessionType } from "@zenflow/shared";

/**
 * Warm Sunrise palette: orange, yellow and lime on warm paper and ink. Hex
 * source of truth for code that paints with raw colours (RN style props, SVG,
 * WebView CSS). The Tailwind tokens in `mobile/app/global.css`,
 * `frontend/src/index.css` and `landing/src/styles/global.css` carry the same
 * values; `mobile/lib/__tests__/palette.test.ts` keeps them in sync.
 */
export const BRAND = {
  /** Primary, light scheme. */
  orange: "#FF8E3E",
  /** Primary, dark scheme. */
  orangeDark: "#FF7A24",
  /** Highlights and assignments. */
  yellow: "#F0B101",
  /** Light accent and done. Fill only. */
  lime: "#D8F998",
  /** Light background. */
  paper: "#FEFCFA",
  /** Dark background and ink. */
  ink: "#0F0D0A",
  /** Soft grey. Dnd and quiet strokes. */
  grey: "#A8A29E",
} as const;

export type Scheme = "light" | "dark";

/** Success fill. */
export const SUCCESS = "#10B981";

/**
 * UI neutrals and roles per scheme. Each key is a CSS variable: `background`,
 * `foreground`, `card`, `muted`, `muted-foreground`, `border`, `primary`,
 * `primary-foreground`, `ring`, `destructive`, `destructive-foreground`,
 * `glass`, `glass-edge` and `success`.
 */
export interface UiTokens {
  /** Page. */
  background: string;
  /** Body text. */
  foreground: string;
  /** Elevated surface: cards, popovers, sheets. */
  card: string;
  /** Secondary, accent and muted fills. */
  muted: string;
  /** Secondary text. */
  mutedForeground: string;
  /** Hairlines, inputs and scrollbars. */
  border: string;
  /** Primary fill: solid buttons and selection. */
  primary: string;
  /** Text on `primary`. */
  primaryForeground: string;
  /** Focus ring, same as `primary`. */
  ring: string;
  /** Destructive and error. */
  destructive: string;
  /** Text on `destructive`. */
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
    background: BRAND.paper,
    foreground: BRAND.ink,
    card: "#FFFFFF",
    muted: "#F6F3EF",
    mutedForeground: "#6F665B",
    border: "#E8E5DF",
    primary: BRAND.orange,
    primaryForeground: "#2B1406",
    ring: BRAND.orange,
    destructive: "#E7000B",
    destructiveForeground: "#FFFFFF",
    glass: "#FFFFFF",
    glassEdge: BRAND.orange,
    success: SUCCESS,
  },
  dark: {
    background: BRAND.ink,
    foreground: "#FBFAF8",
    card: "#1D1A17",
    muted: "#2C2822",
    mutedForeground: "#ACA397",
    border: "#36322D",
    primary: BRAND.orangeDark,
    primaryForeground: "#2B1406",
    ring: BRAND.orangeDark,
    destructive: "#FF6467",
    destructiveForeground: BRAND.ink,
    glass: "#FFECDC",
    glassEdge: "#FFAA64",
    success: "#34D399",
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
 * card. `late` is the only red and marks late and overdue work only.
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
  /** Blue: timetable lectures. */
  lecture: { base: "#3B82C4", ink: { light: "#245C94", dark: "#8FBDE8" } },
  /** Teal. */
  exam: { base: "#14A09B", ink: { light: "#0E6F6B", dark: "#6FD3CD" } },
  /** Yellow. */
  assignment: { base: BRAND.yellow, ink: { light: "#7A5A00", dark: "#F6C93C" } },
  /** Orange: tasks. */
  task: { base: BRAND.orange, ink: { light: "#9A4A0C", dark: "#FFA866" } },
  /** Soft grey: free time and do not disturb. */
  dnd: { base: BRAND.grey, ink: { light: "#5F574D", dark: "#B8B0A4" } },
  /** Green. */
  done: { base: SUCCESS, ink: { light: "#0B6B4B", dark: "#5FD9A9" } },
  /** Red: late and overdue work. */
  late: { base: "#E7000B", ink: { light: "#B80009", dark: "#FF8083" } },
  /** Lime: conflict. */
  conflict: { base: "#9BC53D", ink: { light: "#4F6B14", dark: "#C7E27B" } },
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
