import { Calendar } from "@/components/Icons";
import {
  BottomSheet,
  BottomSheetContent,
  BottomSheetOpenTrigger,
  useBottomSheet,
} from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import { zonedNow } from "@zenflow/core";
import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { addDays, format } from "date-fns";
import { useMemo, useState } from "react";
import { Platform, Pressable, View } from "react-native";

const DAYS_AHEAD = 60;

function dayStart(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Compact "date pill" field for the deadline chip row's Custom date picker
 * (`mockups/task-sheets.html`'s grid-cols-2 date button), backed by the real
 * native OS date picker (`@react-native-community/datetimepicker`) instead of
 * a hand-rolled scrollable day list — per explicit product direction, not the
 * build-from-primitives default this app otherwise follows (adding this
 * native module requires a dev-client rebuild, see `mobile/README.md`'s
 * `expo-dev-client` note; it's already a dependency so this is a rebuild, not
 * new infra).
 *
 * `value`/`onChange` stay in this file's existing "zoned" convention — a
 * `Date` whose *local* fields (as read via the device's own timezone, the
 * only thing JS `Date` getters ever expose) carry the user-tz wall clock,
 * exactly what `@zenflow/core`'s `zonedNow`/`zonedDate` produce. That
 * convention composes with the native picker for free: both the JS runtime
 * and the platform picker widget break an instant into calendar fields using
 * the *same* device-local timezone, so a `zonedNow(tz)`-derived `Date` passed
 * in as `value` displays the correct day regardless of whether the device's
 * own timezone matches `tz`, and the `Date` the picker hands back in
 * `onChange` can be treated as this field's canonical value as-is (after
 * zeroing time-of-day, matching every other Date in this form). This field
 * only ever carries a date, never a time-of-day, so day-boundary correctness
 * in `tz` — not exact instants — is what matters here.
 *
 * Android's `display="default"` opens an OS dialog imperatively (rendered
 * only while `open`, then unmounts itself via `onChange`'s `event.type`).
 * iOS has no such modal affordance for `mode="date"` — its picker is an
 * inline view, not itself a button — so it stays behind this same pill +
 * `BottomSheet` trigger the rest of this form's inline pickers
 * (`TimePickerInline`) already use, with a trailing "Done" button.
 *
 * `@react-native-community/datetimepicker` ships no `.web` variant (its
 * platform-less fallback renders `null` and warns — the same "no web
 * implementation" situation `react-native-webview` puts `DescriptionField`
 * in, see `mobile/README.md`'s pitfalls section). This screen isn't a
 * shipping web flow today, so it falls through to the same `BottomSheet` +
 * `DateTimePicker` path as iOS rather than carrying a third UI just for web;
 * revisit with a real web fallback if web task-creation becomes supported.
 */
export function InlineDateField({
  value,
  onChange,
  tz,
  disabled,
  minDate,
  maxDate,
}: {
  value: Date | undefined;
  onChange: (date: Date) => void;
  tz: string;
  disabled?: boolean;
  /** Earliest selectable date, inclusive. Defaults to today in `tz` — dates
   * before today (in `tz`) are never selectable even if a caller passes an
   * earlier `minDate`. */
  minDate?: Date;
  /** Latest selectable date, inclusive. Defaults to `minDate + DAYS_AHEAD - 1`. */
  maxDate?: Date;
}) {
  const { minimumDate, maximumDate } = useMemo(() => {
    const today = dayStart(zonedNow(tz));
    const floor =
      minDate && dayStart(minDate) > today ? dayStart(minDate) : today;
    const ceiling = maxDate
      ? dayStart(maxDate)
      : addDays(floor, DAYS_AHEAD - 1);
    return { minimumDate: floor, maximumDate: ceiling };
  }, [tz, minDate, maxDate]);

  // Falls back to `minimumDate` (today in `tz`, or `minDate`) when nothing is
  // selected yet, so the native picker always opens somewhere in range.
  const anchor = value ?? minimumDate;

  const [open, setOpen] = useState(false);
  const bottomSheet = useBottomSheet();

  const trigger = (
    <Pressable
      onPress={Platform.OS === "android" ? () => setOpen(true) : undefined}
      className={cn(
        "h-[46px] flex-row items-center justify-between rounded-xl border border-input bg-card px-3",
        disabled && "opacity-50",
      )}
    >
      <Text className="text-[13.5px] font-medium text-foreground">
        {value ? format(value, "EEE, MMM d") : "Select date"}
      </Text>
      <Calendar size={16} className="shrink-0 text-muted-foreground" />
    </Pressable>
  );

  if (Platform.OS === "android") {
    const handleChange = (event: DateTimePickerEvent, selected?: Date) => {
      setOpen(false);
      if (event.type === "dismissed" || !selected) return;
      onChange(dayStart(selected));
    };
    return (
      <>
        {trigger}
        {open && (
          <DateTimePicker
            value={anchor}
            mode="date"
            display="default"
            minimumDate={minimumDate}
            maximumDate={maximumDate}
            onChange={handleChange}
          />
        )}
      </>
    );
  }

  return (
    <BottomSheet>
      <BottomSheetOpenTrigger asChild disabled={disabled}>
        {trigger}
      </BottomSheetOpenTrigger>
      <BottomSheetContent ref={bottomSheet.ref}>
        <View className="px-5">
          <Text className="text-[19px] font-bold tracking-tight">
            Pick a date
          </Text>
        </View>
        <View className="mt-3 items-center px-5">
          <DateTimePicker
            value={anchor}
            mode="date"
            display="default"
            minimumDate={minimumDate}
            maximumDate={maximumDate}
            onChange={(_event, selected) => {
              if (selected) onChange(dayStart(selected));
            }}
          />
        </View>
        <View className="px-5 pt-4">
          <Button className="w-full" onPress={bottomSheet.close}>
            <Text className="font-semibold text-primary-foreground">Done</Text>
          </Button>
        </View>
      </BottomSheetContent>
    </BottomSheet>
  );
}
