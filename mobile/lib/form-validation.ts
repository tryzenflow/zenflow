/**
 * Where a session-form error lives on screen. React Hook Form reports errors by
 * schema path; the form shows them under a handful of fields (date, start and
 * end all sit under "When"). `FORM_FIELD_ORDER` is top-to-bottom reading order,
 * so the first invalid field is the one nearest the top.
 */
export type FormFieldKey =
  | "title"
  | "duration"
  | "deadline"
  | "sessionCount"
  | "when"
  | "rrule"
  | "note"
  | "location"
  | "tags"
  | "reminders";

export const FORM_FIELD_ORDER: FormFieldKey[] = [
  "title",
  "duration",
  "deadline",
  "sessionCount",
  "when",
  "rrule",
  "note",
  "location",
  "tags",
  "reminders",
];

const ALIAS: Record<string, FormFieldKey> = {
  date: "when",
  startTime: "when",
  endTime: "when",
};

/** Fields that live inside the collapsed "More details" disclosure. */
export const DETAIL_FIELDS: FormFieldKey[] = [
  "note",
  "location",
  "tags",
  "reminders",
];

/** The on-screen field keys that currently carry an error, in reading order. */
export function invalidFields(
  errors: Record<string, unknown>,
): FormFieldKey[] {
  const hit = new Set<FormFieldKey>();
  for (const [name, error] of Object.entries(errors)) {
    if (!error) continue;
    const key = ALIAS[name] ?? (name as FormFieldKey);
    if (FORM_FIELD_ORDER.includes(key)) hit.add(key);
  }
  return FORM_FIELD_ORDER.filter((key) => hit.has(key));
}

export function firstInvalidField(
  errors: Record<string, unknown>,
): FormFieldKey | null {
  return invalidFields(errors)[0] ?? null;
}

/** True when an error sits inside the "More details" disclosure. */
export function hasDetailError(errors: Record<string, unknown>): boolean {
  return invalidFields(errors).some((key) => DETAIL_FIELDS.includes(key));
}

/**
 * Whether an existing session already carries any "More details" content, so
 * the disclosure opens by itself instead of hiding what the user saved.
 */
export function hasDetailContent(values: {
  note?: string | null;
  location?: string | null;
  tags?: string[] | null;
  reminders?: number[] | null;
}): boolean {
  const note = (values.note ?? "").replace(/<[^>]*>/g, "").trim();
  return (
    note.length > 0 ||
    !!values.location?.trim() ||
    (values.tags?.length ?? 0) > 0 ||
    (values.reminders?.length ?? 0) > 0
  );
}

export const TITLE_COUNTER_FROM = 0.8;

/** The character counter only shows once the title is near its limit. */
export function showTitleCounter(length: number, max: number): boolean {
  return length >= Math.floor(max * TITLE_COUNTER_FROM);
}

/** Duration presets (minutes) offered as one-tap chips above the 15-minute stepper. */
export const DURATION_PRESETS = [30, 60, 90, 120] as const;

const stripHtml = (html?: string | null) =>
  (html ?? "").replace(/<[^>]*>/g, "").trim();

/** True when a `dirtyFields` tree (RHF) has any truthy leaf. */
function anyDirty(node: unknown): boolean {
  if (!node) return false;
  if (Array.isArray(node)) return node.some(anyDirty);
  if (typeof node === "object") return Object.values(node).some(anyDirty);
  return true;
}

/**
 * Edit form: dirty means a real change. The rich-text editor reports an empty
 * paragraph on mount, which RHF counts as a change, so `note` only counts when
 * its visible text differs from where it started.
 */
export function isFormDirty(
  dirtyFields: Record<string, unknown>,
  values: { note?: string | null },
  defaults: { note?: string | null } | undefined,
): boolean {
  for (const [key, node] of Object.entries(dirtyFields)) {
    if (key === "note") {
      if (anyDirty(node) && stripHtml(values.note) !== stripHtml(defaults?.note))
        return true;
    } else if (anyDirty(node)) return true;
  }
  return false;
}

/** Create form: anything typed or picked beyond the defaults. */
export function hasNewSessionInput(values: {
  title?: string | null;
  note?: string | null;
  location?: string | null;
  tags?: string[] | null;
}): boolean {
  return (
    !!values.title?.trim() ||
    stripHtml(values.note).length > 0 ||
    !!values.location?.trim() ||
    (values.tags?.length ?? 0) > 0
  );
}
