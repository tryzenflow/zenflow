import { useLanguage } from "@/hooks/use-language";
import { dateFnsLocale, t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  type RecurrenceFreq,
  fromRrule,
  toRrule,
} from "@zenflow/core";
import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
import { View } from "react-native";
import { Chip, ChipGroup } from "./chip-group";
import { Text } from "./text";

/** RFC 5545 weekday codes, Monday first, with a Monday 2026-10-12 anchor for names. */
const DAYS: { code: string; index: number }[] = [
  { code: "MO", index: 0 },
  { code: "TU", index: 1 },
  { code: "WE", index: 2 },
  { code: "TH", index: 3 },
  { code: "FR", index: 4 },
  { code: "SA", index: 5 },
  { code: "SU", index: 6 },
];
const MONDAY_ANCHOR = new Date(2026, 9, 12);

/** How long a weekly or daily repeat runs, in whole weeks. `null` is forever. */
const ENDS = [
  { value: "forever", weeks: null, label: "Forever" },
  { value: "4", weeks: 4, label: "4 weeks" },
  { value: "12", weeks: 12, label: "12 weeks" },
] as const;

type EndValue = (typeof ENDS)[number]["value"];

function codeOf(isoDate: string): string {
  const dow = parseISO(isoDate).getDay();
  return DAYS[(dow + 6) % 7].code;
}

/** Weeks a repeat runs from `anchor`, when `until` (`YYYY-MM-DD`) closes whole weeks. */
function weeksUntil(anchor: string, until: string | undefined): number | null {
  if (!until) return null;
  const span = differenceInCalendarDays(parseISO(until), parseISO(anchor)) + 1;
  return span > 0 && span % 7 === 0 ? span / 7 : null;
}

/** `YYYY-MM-DD`, the last day of `weeks` whole weeks from `anchor`, inclusive. */
function untilFor(anchor: string, weeks: number): string {
  return format(addDays(parseISO(anchor), weeks * 7 - 1), "yyyy-MM-dd");
}

/**
 * Repeat picker as a sentence. Three frequencies, a weekday row for weekly
 * repeats (defaults to the anchor's weekday), and how long it runs. The
 * sentence under the controls says what will happen, and updates as you tap.
 * Emits an RRULE subset string, or `undefined` for a one-off.
 */
export function SentenceRepeat({
  value,
  onChange,
  anchorDate,
  disabled,
  testID,
}: {
  value: string | undefined;
  onChange: (rrule: string | undefined) => void;
  /** `YYYY-MM-DD` the repeat starts on. Drives the default weekday and the end date. */
  anchorDate: string;
  disabled?: boolean;
  testID?: string;
}) {
  useLanguage();
  const state = fromRrule(value);
  const freq: RecurrenceFreq = state.freq;
  const anchorCode = codeOf(anchorDate);
  const byday = state.byday.length > 0 ? state.byday : [anchorCode];
  const weeks = weeksUntil(anchorDate, state.until);
  const endValue: EndValue | null =
    weeks === null
      ? "forever"
      : ENDS.find((e) => e.weeks === weeks)?.value ?? null;

  function emit(next: {
    freq: RecurrenceFreq;
    byday: string[];
    weeks: number | null;
  }) {
    onChange(
      toRrule({
        freq: next.freq,
        byday: next.freq === "WEEKLY" ? next.byday : [],
        until:
          next.freq === "NONE" || next.weeks === null
            ? undefined
            : untilFor(anchorDate, next.weeks),
      }),
    );
  }

  function setFreq(next: RecurrenceFreq) {
    emit({ freq: next, byday, weeks });
  }

  function toggleDay(code: string) {
    const has = byday.includes(code);
    // A weekly repeat keeps at least one day.
    if (has && byday.length === 1) return;
    const days = has ? byday.filter((c) => c !== code) : [...byday, code];
    emit({ freq, byday: days, weeks });
  }

  const ordered = DAYS.filter((d) => byday.includes(d.code));
  const dayNames = ordered.map((d) =>
    format(addDays(MONDAY_ANCHOR, d.index), "EEEE", { locale: dateFnsLocale() }),
  );
  const endLabel =
    weeks === null
      ? t("forever")
      : t("for {weeks} weeks", { weeks: String(weeks) });
  const sentence =
    freq === "NONE"
      ? t("Does not repeat.")
      : freq === "DAILY"
        ? t("Repeats every day, {ending}.", { ending: endLabel })
        : t("Repeats every {days}, {ending}.", {
            days: joinNames(dayNames),
            ending: endLabel,
          });

  return (
    <View testID={testID} className="gap-3">
      <ChipGroup<RecurrenceFreq>
        testID={testID ? `${testID}.freq` : undefined}
        value={freq}
        disabled={disabled}
        onChange={setFreq}
        options={[
          { value: "NONE", label: "Once" },
          { value: "DAILY", label: "Daily" },
          { value: "WEEKLY", label: "Weekly" },
        ]}
      />

      {freq === "WEEKLY" && (
        <View
          testID={testID ? `${testID}.days` : undefined}
          className="flex-row flex-wrap gap-2"
        >
          {DAYS.map((d) => (
            <Chip
              key={d.code}
              testID={testID ? `${testID}.day.${d.code}` : undefined}
              label={format(addDays(MONDAY_ANCHOR, d.index), "EEEEEE", {
                locale: dateFnsLocale(),
              })}
              active={byday.includes(d.code)}
              disabled={disabled}
              onPress={() => toggleDay(d.code)}
            />
          ))}
        </View>
      )}

      {freq !== "NONE" && (
        <ChipGroup<EndValue>
          testID={testID ? `${testID}.end` : undefined}
          value={endValue}
          disabled={disabled}
          onChange={(v) => {
            const end = ENDS.find((e) => e.value === v);
            emit({ freq, byday, weeks: end?.weeks ?? null });
          }}
          options={ENDS.map((e) => ({ value: e.value, label: e.label }))}
        />
      )}

      <Text
        testID={testID ? `${testID}.sentence` : undefined}
        accessibilityLiveRegion="polite"
        className={cn(
          "text-[13.5px] leading-snug text-muted-foreground",
          freq !== "NONE" && "text-foreground",
        )}
      >
        {sentence}
      </Text>
    </View>
  );
}

/** "Monday, Wednesday and Friday" in the app's language. */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} ${t("and")} ${names[names.length - 1]}`;
}
