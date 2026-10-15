import { FOCUS_BANDS, type FocusBand } from "@zenflow/shared";
import { t } from "./i18n";

/**
 * Onboarding's "When do you focus best?" options. Hours mirror the bands in
 * `@zenflow/shared` (`FOCUS_BANDS`). RN-free so it can be unit-tested
 * (`lib/__tests__/focus-band.test.ts`).
 */

/** Local start and end of each band, as `HH:mm`. */
export const FOCUS_BAND_HOURS: Record<FocusBand, { from: string; to: string }> =
  {
    MORNING: { from: "08:00", to: "12:00" },
    AFTERNOON: { from: "12:00", to: "17:00" },
    EVENING: { from: "17:00", to: "21:00" },
    LATE_NIGHT: { from: "21:00", to: "02:00" },
  };

/** Preselected in onboarding so the step is one tap. */
export const DEFAULT_FOCUS_BAND: FocusBand = "MORNING";

/** Minute of day a focus band starts; 8:00 when none was chosen. */
export function focusBandStartMin(band: FocusBand | null | undefined): number {
  const [h, m] = FOCUS_BAND_HOURS[band ?? DEFAULT_FOCUS_BAND].from
    .split(":")
    .map(Number);
  return h * 60 + m;
}

const LABEL: Record<FocusBand, string> = {
  MORNING: "Morning",
  AFTERNOON: "Afternoon",
  EVENING: "Evening",
  LATE_NIGHT: "Late night",
};

export interface FocusBandOption {
  band: FocusBand;
  label: string;
  /** Localized "{from} to {to}" range. */
  hours: string;
}

/** The four options in display order. Labels read through `t()` on each call. */
export function focusBandOptions(): FocusBandOption[] {
  return FOCUS_BANDS.map((band) => {
    const { from, to } = FOCUS_BAND_HOURS[band];
    return {
      band,
      label: t(LABEL[band]),
      hours: t("{from} to {to}", { from, to }),
    };
  });
}
