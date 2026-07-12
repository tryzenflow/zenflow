import { DarkTheme, DefaultTheme, type Theme } from '@react-navigation/native';

// Hex mirror of the "Warm Sunrise" oklch tokens in global.css — React
// Navigation's Theme type (used for header/tab-bar native chrome) takes
// plain color strings, not CSS custom properties, so this can't reference
// global.css directly. Keep these two in sync by hand.
export const THEME = {
  light: {
    background: '#fefcfa',
    foreground: '#0f0d0a',
    card: '#ffffff',
    cardForeground: '#0f0d0a',
    popover: '#ffffff',
    popoverForeground: '#0f0d0a',
    primary: '#ff8e3e',
    primaryForeground: '#2b1406',
    secondary: '#f6f3ef',
    secondaryForeground: '#1c1a18',
    muted: '#f6f3ef',
    mutedForeground: '#797065',
    accent: '#f6f3ef',
    accentForeground: '#1c1a18',
    destructive: '#e7000b',
    border: '#e8e5df',
    input: '#e8e5df',
    ring: '#ff8e3e',
    radius: '0.375rem',
    chart1: '#ff8e3e',
    chart2: '#f0b101',
    chart3: '#a8ce4e',
    chart4: '#e34d00',
    chart5: '#83af3e',
  },
  dark: {
    background: '#0f0d0a',
    foreground: '#fbfaf8',
    card: '#1d1a17',
    cardForeground: '#fbfaf8',
    popover: '#1d1a17',
    popoverForeground: '#fbfaf8',
    primary: '#ff7a24',
    primaryForeground: '#2b1406',
    secondary: '#2c2823',
    secondaryForeground: '#fbfaf8',
    muted: '#2c2822',
    mutedForeground: '#aca397',
    accent: '#2c2823',
    accentForeground: '#fbfaf8',
    destructive: '#ff6467',
    border: '#36322d',
    input: '#36322d',
    ring: '#ff7a24',
    radius: '0.375rem',
    chart1: '#ff7a24',
    chart2: '#f6b915',
    chart3: '#bde16d',
    chart4: '#ed5f18',
    chart5: '#92bf4f',
  },
};

export const NAV_THEME: Record<'light' | 'dark', Theme> = {
  light: {
    ...DefaultTheme,
    colors: {
      background: THEME.light.background,
      border: THEME.light.border,
      card: THEME.light.card,
      notification: THEME.light.destructive,
      primary: THEME.light.primary,
      text: THEME.light.foreground,
    },
  },
  dark: {
    ...DarkTheme,
    colors: {
      background: THEME.dark.background,
      border: THEME.dark.border,
      card: THEME.dark.card,
      notification: THEME.dark.destructive,
      primary: THEME.dark.primary,
      text: THEME.dark.foreground,
    },
  },
};
