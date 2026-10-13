import { t } from "./i18n";

/**
 * One-liners the boot screen cycles through while the app starts. Only things
 * you can't see on screen: gestures and rules with no button of their own.
 * (Everything visible is covered by the Getting started checklist.) Read
 * through `t()` on access so a language switch is picked up.
 */
export function bootHints(): string[] {
  return [
    t("Pinch the day to zoom the hours."),
    t("Swipe the date strip to jump a whole week."),
    t("Drag a held task to the screen edge to scroll as you move."),
    t("Hold a task without moving for Move to… and more."),
    t("Swipe a notification left to dismiss it."),
  ];
}
