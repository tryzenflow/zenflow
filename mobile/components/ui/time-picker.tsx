import { ChevronRight, Clock } from "@/components/Icons";
import {
  BottomSheet,
  BottomSheetContent,
  BottomSheetOpenTrigger,
  BottomSheetScrollView,
  useBottomSheet,
} from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import { minutesToLabel } from "@/utils/preferences";
import { useCallback, useRef } from "react";
import { Pressable, type ScrollView, View } from "react-native";

/** The 12 selectable hours on a 12-hour clock (1 … 12). */
const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);
/** Minutes column always steps by 15 — the scheduler's grid — matching
 * `frontend/src/components/ui/time-picker.tsx`'s `MINUTE_STEPS`. */
const MINUTE_STEPS = [0, 15, 30, 45];
const MERIDIEMS = ["AM", "PM"] as const;
type Meridiem = (typeof MERIDIEMS)[number];

/** Approximate row height (px) used to auto-scroll the active entry into
 * view — doesn't need to be pixel-perfect, just close enough that the
 * active row lands inside the visible ~192px column. */
const ROW_HEIGHT = 44;
const COLUMN_HEIGHT = 208;

/** Split a minutes-of-day value into 12-hour clock parts. */
function toParts(value: number): {
  hour: number;
  minute: number;
  meridiem: Meridiem;
} {
  const clock = Math.min(Math.max(value, 0), 1439);
  const totalHours = Math.floor(clock / 60);
  const minute = clock % 60;
  const meridiem: Meridiem = totalHours >= 12 ? "PM" : "AM";
  const hour = totalHours % 12 === 0 ? 12 : totalHours % 12;
  return { hour, minute, meridiem };
}

/** Recompose 12-hour clock parts back into minutes-of-day. */
function fromParts(hour: number, minute: number, meridiem: Meridiem): number {
  const militaryHour =
    meridiem === "AM" ? (hour === 12 ? 0 : hour) : hour === 12 ? 12 : hour + 12;
  return militaryHour * 60 + minute;
}

function scrollIntoView(
  ref: React.RefObject<ScrollView | null>,
  index: number,
) {
  const y = Math.max(
    0,
    index * ROW_HEIGHT - COLUMN_HEIGHT / 2 + ROW_HEIGHT / 2,
  );
  ref.current?.scrollTo({ y, animated: false });
}

function Column<T extends number | string>({
  items,
  isActive,
  renderLabel,
  onSelect,
  scrollRef,
}: {
  items: T[];
  isActive: (item: T) => boolean;
  renderLabel: (item: T) => string;
  onSelect: (item: T) => void;
  scrollRef?: React.RefObject<ScrollView | null>;
}) {
  return (
    // Was a plain `ScrollView` from "react-native" — nested inside
    // `BottomSheetContent` (a real `@gorhom/bottom-sheet` `BottomSheetModal`
    // on native), a bare RN `ScrollView` fights the sheet's own pan gesture
    // for vertical touch since it isn't registered with gorhom's internal
    // gesture coordination, which is why only taps (not drags) worked on the
    // hour/minute columns. `BottomSheetScrollView` (re-exported per-platform
    // from `@/components/ui/bottom-sheet`) is gorhom's own scrollable that
    // reads `useBottomSheetInternal()` so the sheet yields to it correctly.
    <BottomSheetScrollView
      ref={scrollRef}
      style={{ maxHeight: COLUMN_HEIGHT }}
      className="flex-1 h-full"
      contentContainerClassName="gap-1.5 pb-1"
      showsVerticalScrollIndicator={false}
    >
      {items.map((item) => {
        const active = isActive(item);
        return (
          <Pressable
            key={String(item)}
            onPress={() => onSelect(item)}
            className={cn(
              "h-10 items-center justify-center rounded-lg",
              active ? "bg-primary" : "bg-transparent",
            )}
          >
            <Text
              className={cn(
                "text-[15px] font-medium",
                active ? "text-primary-foreground" : "text-foreground",
              )}
            >
              {renderLabel(item)}
            </Text>
          </Pressable>
        );
      })}
    </BottomSheetScrollView>
  );
}

/** Scroll refs + the `BottomSheetContent.onChange` handler that scrolls the
 * active hour/minute into view whenever the sheet opens — shared by both
 * trigger variants below since the refs must live above `BottomSheetContent`
 * (its `onChange` prop is what fires on every open, not just first mount). */
function useTimePickerScroll(value: number) {
  const hourScrollRef = useRef<ScrollView>(null);
  const minuteScrollRef = useRef<ScrollView>(null);

  const onSheetChange = useCallback(
    (index: number) => {
      if (index < 0) return;
      const parts = toParts(value);
      scrollIntoView(hourScrollRef, HOURS.indexOf(parts.hour));
      scrollIntoView(minuteScrollRef, MINUTE_STEPS.indexOf(parts.minute));
    },
    [value],
  );

  return { hourScrollRef, minuteScrollRef, onSheetChange };
}

/**
 * Shared three-column hour / 15-min-block / AM-PM picker body — RN port of
 * `frontend/src/components/ui/time-picker.tsx`'s popover contents, without
 * that file's dead 23:59-as-59-minutes special case (the backend no longer
 * ever returns a non-grid deadline instant, see `deadline-chip-row.tsx`).
 * Rendered inside a `BottomSheetContent` (RN has no hover/click-outside
 * popover primitive) with a trailing "Done" button, instead of either
 * legacy component's single flat scrollable list.
 */
function TimePickerBody({
  title,
  subtitle,
  value,
  onChange,
  onDone,
  hourScrollRef,
  minuteScrollRef,
}: {
  title: string;
  subtitle?: string;
  value: number;
  onChange: (minutes: number) => void;
  onDone: () => void;
  hourScrollRef: React.RefObject<ScrollView | null>;
  minuteScrollRef: React.RefObject<ScrollView | null>;
}) {
  const { hour, minute, meridiem } = toParts(value);

  const commit = useCallback(
    (h: number, m: number, mer: Meridiem) => onChange(fromParts(h, m, mer)),
    [onChange],
  );

  return (
    <>
      <View className="px-5">
        <Text className="text-[19px] font-bold tracking-tight">{title}</Text>
        {subtitle && (
          <Text className="mt-[3px] text-[13px] text-muted-foreground">
            {subtitle}
          </Text>
        )}
      </View>
      <View className="mt-4 flex-row gap-2 px-5">
        <Column
          items={HOURS}
          isActive={(h) => h === hour}
          renderLabel={(h) => String(h)}
          onSelect={(h) => commit(h, minute, meridiem)}
          scrollRef={hourScrollRef}
        />
        <Column
          items={MINUTE_STEPS}
          isActive={(m) => m === minute}
          renderLabel={(m) => m.toString().padStart(2, "0")}
          onSelect={(m) => commit(hour, m, meridiem)}
          scrollRef={minuteScrollRef}
        />
        <View className="w-16 gap-1.5">
          {MERIDIEMS.map((mer) => (
            <Pressable
              key={mer}
              onPress={() => commit(hour, minute, mer)}
              className={cn(
                "h-10 items-center justify-center rounded-lg",
                mer === meridiem ? "bg-primary" : "bg-transparent",
              )}
            >
              <Text
                className={cn(
                  "text-[15px] font-medium",
                  mer === meridiem
                    ? "text-primary-foreground"
                    : "text-foreground",
                )}
              >
                {mer}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
      <View className="px-5 pt-4">
        <Button className="w-full" onPress={onDone}>
          <Text className="font-semibold text-primary-foreground">Done</Text>
        </Button>
      </View>
    </>
  );
}

export interface TimePickerRowProps {
  label: string;
  /** Bottom-sheet heading, if it should differ from the row label. */
  sheetTitle?: string;
  value: number;
  onChange: (minutes: number) => void;
  className?: string;
  subtitle?: string;
}

/**
 * Labeled "label — value" row that opens the shared time-picker sheet. Not
 * currently used by any screen (the work-hours settings UI it originally
 * backed was removed), but kept as a generic `components/ui/` primitive
 * alongside `TimePickerInline` (which the deadline chip row does use) in
 * case a future feature needs a full-row time picker.
 */
export function TimePickerRow({
  label,
  sheetTitle,
  value,
  onChange,
  className,
  subtitle,
}: TimePickerRowProps) {
  const bottomSheet = useBottomSheet();
  const { hourScrollRef, minuteScrollRef, onSheetChange } =
    useTimePickerScroll(value);

  return (
    <BottomSheet>
      <BottomSheetOpenTrigger asChild>
        <Pressable
          className={cn(
            "flex-row items-center justify-between gap-3 bg-card px-4 py-[15px]",
            className,
          )}
        >
          <Text className="flex-1 text-[15px] font-semibold">{label}</Text>
          <Text className="text-sm font-medium text-muted-foreground">
            {minutesToLabel(value)}
          </Text>
          <ChevronRight size={18} className="text-muted-foreground" />
        </Pressable>
      </BottomSheetOpenTrigger>
      <BottomSheetContent
        ref={bottomSheet.ref}
        enableDynamicSizing={false}
        snapPoints={["50%"]}
        onChange={onSheetChange}
      >
        <TimePickerBody
          title={sheetTitle ?? label}
          subtitle={subtitle}
          value={value}
          onChange={onChange}
          onDone={bottomSheet.close}
          hourScrollRef={hourScrollRef}
          minuteScrollRef={minuteScrollRef}
        />
      </BottomSheetContent>
    </BottomSheet>
  );
}

export interface TimePickerInlineProps {
  value: number;
  onChange: (minutes: number) => void;
  disabled?: boolean;
  label?: string;
}

/**
 * Compact "time pill" trigger for the deadline chip row's Today/Tomorrow/
 * Custom time-of-day picker (`mockups/task-sheets.html`'s grid-cols-2 time
 * button), opening the same shared sheet as `TimePickerRow`. Stacking a
 * second modal on top of the create/edit sheet is a supported pattern under
 * one shared `BottomSheetModalProvider` (mounted once in `app/_layout.tsx`),
 * same mechanism `components/ui/combobox.tsx` already relies on.
 */
export function TimePickerInline({
  value,
  onChange,
  disabled,
  label = "Pick a time",
}: TimePickerInlineProps) {
  const bottomSheet = useBottomSheet();
  const { hourScrollRef, minuteScrollRef, onSheetChange } =
    useTimePickerScroll(value);

  return (
    <BottomSheet>
      <BottomSheetOpenTrigger asChild disabled={disabled}>
        <Pressable
          className={cn(
            "h-[46px] flex-row items-center justify-between rounded-xl border border-input bg-card px-3",
            disabled && "opacity-50",
          )}
        >
          <Text className="text-[13.5px] font-medium text-foreground">
            {minutesToLabel(value)}
          </Text>
          <Clock size={16} className="shrink-0 text-muted-foreground" />
        </Pressable>
      </BottomSheetOpenTrigger>
      <BottomSheetContent
        ref={bottomSheet.ref}
        enableDynamicSizing={false}
        snapPoints={["50%"]}
        onChange={onSheetChange}
      >
        <TimePickerBody
          title={label}
          value={value}
          onChange={onChange}
          onDone={bottomSheet.close}
          hourScrollRef={hourScrollRef}
          minuteScrollRef={minuteScrollRef}
        />
      </BottomSheetContent>
    </BottomSheet>
  );
}
