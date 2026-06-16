/**
 * True when a keyboard event originates from somewhere the user is editing
 * text — a text input, textarea, native select, any `contenteditable` host, or
 * anything inside a task create/edit panel/form. Global keyboard shortcuts must
 * bail out in that case so typing (e.g. a title or description) never doubles
 * as a navigation/view command.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;

  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;

  // TipTap / rich-text and any other contenteditable host.
  if (target.isContentEditable) return true;

  // Belt-and-braces: ignore anything within a task create/edit form/panel even
  // if the focused node itself isn't an obvious editable element.
  if (target.closest('form, [role="dialog"], [contenteditable="true"]'))
    return true;

  return false;
}
