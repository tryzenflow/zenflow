// Re-export calendar constants from the shared core package.
export {
  DAILY_HORIZON,
  TIME_GRANULARITY,
  WEEK_STARTS_ON,
} from "@zenflow/core";

// React Navigation's native header/tab-bar chrome takes plain color strings, not `className` —
// this is the one hand-maintained hex mirror of the Warm Sunrise tokens for that purpose only.
// Keep in sync with app/global.css.
export const NAV_THEME = {
  light: {
    background: "#FEFCFA",
    border: "#E8E5DF",
    card: "#FFFFFF",
    notification: "#E7000B",
    primary: "#FF8E3E",
    // Orange for text/icons (AA on light surfaces); `primary` stays the fill.
    primaryText: "#B24800",
    warning: "#825600",
    text: "#0F0D0A",
    mutedForeground: "#6E665C",
  },
  dark: {
    background: "#0F0D0A",
    border: "#36322D",
    card: "#1D1A17",
    notification: "#FF6467",
    primary: "#FF7A24",
    primaryText: "#FF7A24",
    warning: "#F6B915",
    text: "#FBFAF8",
    mutedForeground: "#ACA397",
  },
};

/** `#RRGGBB` plus an opacity (0-1) as `#RRGGBBAA`, so translucent fills come from the theme tokens. */
export function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255);
  return `${hex}${a.toString(16).padStart(2, "0")}`;
}

/**
 * Upper bounds for system font scaling (`maxFontSizeMultiplier`). Text still
 * follows the user's size, but dense chrome stops growing before it breaks:
 * the tab bar and day strip are fixed-height rows, the time grid is 15-minute
 * blocks. Everything else (login, sheets, lists) scales freely.
 */
export const FONT_SCALE_CAP = {
  chrome: 1.2,
  grid: 1.3,
} as const;
