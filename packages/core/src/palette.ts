import type { SessionCardState, SessionType } from "@zenflow/shared";

/**
 * Sand and slate palette. Hex source of truth for code that paints with raw
 * colours (RN style props, SVG, WebView CSS). The Tailwind tokens in
 * `mobile/app/global.css` and `frontend/src/index.css` carry the same values;
 * `mobile/lib/__tests__/palette.test.ts` keeps them in sync and checks AA.
 */
export const BRAND = {
  slate: "#6C7BF7",
  sun: "#FFD66B",
  sand: "#FBFAF7",
  deepSlate: "#15161F",
} as const;

export type Scheme = "light" | "dark";

/** Page and card surfaces a session block can sit on. */
export const SURFACES: Record<Scheme, { background: string; card: string }> = {
  light: { background: BRAND.sand, card: "#FFFFFF" },
  dark: { background: BRAND.deepSlate, card: "#1E2030" },
};

/**
 * Colour roles for session blocks. `late` (cherry) is the only red and marks
 * late and overdue work only. `conflict` reuses the sun accent.
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
  lecture: { base: "#5AB2FF", ink: { light: "#0066C2", dark: "#6CB9FF" } },
  exam: { base: "#FF6F91", ink: { light: "#B8285F", dark: "#FF8AA6" } },
  assignment: { base: "#FFB547", ink: { light: "#925600", dark: "#FFB547" } },
  task: { base: BRAND.slate, ink: { light: "#3D4FE6", dark: "#9AA4FA" } },
  dnd: { base: "#B9B6C9", ink: { light: "#635E80", dark: "#B9B6C9" } },
  done: { base: "#4FD1A5", ink: { light: "#1C7457", dark: "#4FD1A5" } },
  late: { base: "#F0475C", ink: { light: "#C21A30", dark: "#F47D8C" } },
  conflict: { base: BRAND.sun, ink: { light: "#7E5F00", dark: BRAND.sun } },
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
