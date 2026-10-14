// Re-export calendar constants from the shared core package.
export {
  DAILY_HORIZON,
  TIME_GRANULARITY,
  WEEK_STARTS_ON,
} from "@zenflow/core";

// React Navigation's native header/tab-bar chrome takes plain color strings, not `className` —
// this is the one hand-maintained hex mirror of the Blueberry milk tokens for that purpose only.
// Keep in sync with app/global.css.
export const NAV_THEME = {
  light: {
    background: "#FBFAF7",
    border: "#E6E5EE",
    card: "#FFFFFF",
    notification: "#6C7BF7",
    primary: "#6C7BF7",
    text: "#1C1D2B",
    mutedForeground: "#686A7E",
  },
  dark: {
    background: "#15161F",
    border: "#2E3043",
    card: "#1E2030",
    notification: "#6C7BF7",
    primary: "#6C7BF7",
    text: "#ECECF4",
    mutedForeground: "#A3A5B8",
  },
};
