import { UI } from "@zenflow/core";

// Re-export calendar constants from the shared core package.
export {
  DAILY_HORIZON,
  TIME_GRANULARITY,
  WEEK_STARTS_ON,
} from "@zenflow/core";

// React Navigation's native header/tab-bar chrome takes plain color strings, not `className`.
// Derived from the core `UI` tokens, the same values app/global.css carries.
export const NAV_THEME = {
  light: {
    background: UI.light.background,
    border: UI.light.border,
    card: UI.light.card,
    notification: UI.light.primary,
    primary: UI.light.primary,
    text: UI.light.foreground,
    mutedForeground: UI.light.mutedForeground,
  },
  dark: {
    background: UI.dark.background,
    border: UI.dark.border,
    card: UI.dark.card,
    notification: UI.dark.primary,
    primary: UI.dark.primary,
    text: UI.dark.foreground,
    mutedForeground: UI.dark.mutedForeground,
  },
};
