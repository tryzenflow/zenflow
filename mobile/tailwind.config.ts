// @ts-expect-error - no types
import nativewind from "nativewind/preset";
import { hairlineWidth } from "nativewind/theme";

export default {
  darkMode: "class",
  // `./lib` matters: `lib/task-card.ts` holds the Month View's per-state pill
  // class maps (`MONTH_PILL_CLASSES`/`MONTH_PILL_TEXT_CLASSES`). Class strings
  // that live outside these globs are never seen by the scanner, so the
  // utilities are never generated and the classes silently no-op at runtime —
  // which left overdue pills with RN's default black border and no background.
  // `@zenflow/core` matters for the same reason: `session-type.ts`'s
  // `SESSION_TYPE_META` holds the per-type `dotClass`/`badgeClass`/`textClass`
  // strings (`bg-session-lecture`, …) that the week-header dot row and the
  // type badge render; without it those dots are invisible. The web app scans it the same way (`@source` in `index.css`).
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
    "../packages/core/src/**/*.{ts,tsx}",
  ],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        border: "rgb(var(--border) / <alpha-value>)",
        glass: {
          DEFAULT: "rgb(var(--glass) / <alpha-value>)",
          edge: "rgb(var(--glass-edge) / <alpha-value>)",
        },
        input: "rgb(var(--input) / <alpha-value>)",
        ring: "rgb(var(--ring) / <alpha-value>)",
        background: "rgb(var(--background) / <alpha-value>)",
        foreground: "rgb(var(--foreground) / <alpha-value>)",
        primary: {
          DEFAULT: "rgb(var(--primary) / <alpha-value>)",
          foreground: "rgb(var(--primary-foreground) / <alpha-value>)",
        },
        secondary: {
          DEFAULT: "rgb(var(--secondary) / <alpha-value>)",
          foreground: "rgb(var(--secondary-foreground) / <alpha-value>)",
        },
        destructive: {
          DEFAULT: "rgb(var(--destructive) / <alpha-value>)",
          foreground: "rgb(var(--destructive-foreground) / <alpha-value>)",
        },
        muted: {
          DEFAULT: "rgb(var(--muted) / <alpha-value>)",
          foreground: "rgb(var(--muted-foreground) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "rgb(var(--accent) / <alpha-value>)",
          foreground: "rgb(var(--accent-foreground) / <alpha-value>)",
        },
        popover: {
          DEFAULT: "rgb(var(--popover) / <alpha-value>)",
          foreground: "rgb(var(--popover-foreground) / <alpha-value>)",
        },
        card: {
          DEFAULT: "rgb(var(--card) / <alpha-value>)",
          foreground: "rgb(var(--card-foreground) / <alpha-value>)",
        },
        brand: {
          orange: "rgb(var(--brand-orange) / <alpha-value>)",
          yellow: "rgb(var(--brand-yellow) / <alpha-value>)",
          lime: "rgb(var(--brand-lime) / <alpha-value>)",
        },
        session: {
          lecture: {
            DEFAULT: "rgb(var(--session-lecture) / <alpha-value>)",
            ink: "rgb(var(--session-lecture-ink) / <alpha-value>)",
          },
          exam: {
            DEFAULT: "rgb(var(--session-exam) / <alpha-value>)",
            ink: "rgb(var(--session-exam-ink) / <alpha-value>)",
          },
          assignment: {
            DEFAULT: "rgb(var(--session-assignment) / <alpha-value>)",
            ink: "rgb(var(--session-assignment-ink) / <alpha-value>)",
          },
          task: {
            DEFAULT: "rgb(var(--session-task) / <alpha-value>)",
            ink: "rgb(var(--session-task-ink) / <alpha-value>)",
          },
          dnd: {
            DEFAULT: "rgb(var(--session-dnd) / <alpha-value>)",
            ink: "rgb(var(--session-dnd-ink) / <alpha-value>)",
          },
          done: {
            DEFAULT: "rgb(var(--session-done) / <alpha-value>)",
            ink: "rgb(var(--session-done-ink) / <alpha-value>)",
          },
          late: {
            DEFAULT: "rgb(var(--session-late) / <alpha-value>)",
            ink: "rgb(var(--session-late-ink) / <alpha-value>)",
          },
          conflict: {
            DEFAULT: "rgb(var(--session-conflict) / <alpha-value>)",
            ink: "rgb(var(--session-conflict-ink) / <alpha-value>)",
          },
        },
        success: "rgb(var(--success) / <alpha-value>)",
      },
      borderWidth: {
        hairline: hairlineWidth(),
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies import("tailwindcss").Config;
