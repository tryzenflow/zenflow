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
    text: "#0F0D0A",
    mutedForeground: "#797065",
  },
  dark: {
    background: "#0F0D0A",
    border: "#36322D",
    card: "#1D1A17",
    notification: "#FF6467",
    primary: "#FF7A24",
    text: "#FBFAF8",
    mutedForeground: "#ACA397",
  },
};
