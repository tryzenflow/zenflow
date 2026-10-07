import * as Haptics from "expo-haptics";

/**
 * One place for the app's haptic vocabulary, so call sites say what happened
 * and never repeat the `.catch` (haptics are best-effort; web and some
 * emulators reject).
 *
 * - `tap`: a primary action committed (create, save, prev/next, toggle).
 * - `select`: a choice moved (chip, stepper, tab, checkbox).
 * - `success` / `warning`: an outcome worth feeling.
 */
export const haptic = {
  tap: () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(noop),
  select: () => void Haptics.selectionAsync().catch(noop),
  success: () =>
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(noop),
  warning: () =>
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(noop),
};

function noop() {}
