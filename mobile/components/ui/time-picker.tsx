import { Clock, ChevronRight } from "@/components/Icons";
import {
  BottomSheet,
  BottomSheetContent,
  BottomSheetOpenTrigger,
  BottomSheetView,
  useBottomSheet,
} from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useLanguage } from "@/hooks/use-language";
import { getLanguage, t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { minutesToLabel } from "@/utils/preferences";
import * as Haptics from "expo-haptics";
import { useCallback } from "react";
import { Pressable, View } from "react-native";

/** Minutes always step by 15, the scheduler's grid (see `frontend/src/components/ui/time-picker.tsx`). */
const MINUTE_STEPS = [0, 15, 30, 45];
const MERIDIEMS = ["AM", "PM"] as const;
type Meridiem = (typeof MERIDIEMS)[number];

/** English reads a 12-hour clock with AM/PM; Vietnamese a 24-hour clock. */
const is24h = () => getLanguage() === "vi";

/** Hour grid: every hour on screen at once, no scrolling (3 rows of 4, or 4 rows of 6). */
const HOURS_12 = Array.from({ length: 12 }, (_, i) => i + 1);
const HOURS_24 = Array.from({ length: 24 }, (_, i) => i);

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

function Cell({
  label,
  active,
  onPress,
  className,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  className?: string;
}) {
  return (
    <Pressable
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        onPress();
      }}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      className={cn(
        "h-11 items-center justify-center rounded-xl border",
        active
          ? "border-primary bg-primary"
          : "border-border bg-muted/60 active:bg-muted",
        className,
      )}
    >
      <Text
        className={cn(
          "text-[16px] font-medium tabular-nums",
          active ? "text-primary-foreground" : "text-foreground",
        )}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="gap-2">
      <Text className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </Text>
      {children}
    </View>
  );
}

/** Lays `items` out in rows of `perRow` equal cells. */
function Grid<T extends number | string>({
  items,
  perRow,
  render,
}: {
  items: T[];
  perRow: number;
  render: (item: T) => React.ReactNode;
}) {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += perRow) {
    rows.push(items.slice(i, i + perRow));
  }
  return (
    <View className="gap-2">
      {rows.map((row) => (
        <View key={String(row[0])} className="flex-row gap-2">
          {row.map((item) => (
            <View key={String(item)} className="flex-1">
              {render(item)}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

/**
 * Hour / 15-minute / AM-PM picker body, RN port of
 * `frontend/src/components/ui/time-picker.tsx`. Every option is visible at
 * once (no scroll columns), so the sheet sizes itself to its content with no
 * dead space under the Done button. English: 12 hours + AM/PM. Vietnamese:
 * 24 hours, no meridiem.
 */
function TimePickerBody({
  title,
  subtitle,
  value,
  onChange,
  onDone,
}: {
  title: string;
  subtitle?: string;
  value: number;
  onChange: (minutes: number) => void;
  onDone: () => void;
}) {
  useLanguage();
  const h24 = is24h();
  const { hour, minute, meridiem } = toParts(value);
  const hour24 = Math.floor(Math.min(Math.max(value, 0), 1439) / 60);

  const setHour24 = useCallback(
    (h: number) => onChange(h * 60 + minute),
    [onChange, minute],
  );
  const commit12 = useCallback(
    (h: number, m: number, mer: Meridiem) => onChange(fromParts(h, m, mer)),
    [onChange],
  );

  return (
    <BottomSheetView hadHeader={false} className="gap-4 px-5">
      <View>
        <Text className="text-[19px] font-bold tracking-tight">{t(title)}</Text>
        {subtitle && (
          <Text className="mt-[3px] text-[13px] text-muted-foreground">
            {subtitle}
          </Text>
        )}
      </View>

      <Section title={t("Hour")}>
        {h24 ? (
          <Grid
            items={HOURS_24}
            perRow={6}
            render={(h) => (
              <Cell
                label={String(h).padStart(2, "0")}
                active={h === hour24}
                onPress={() => setHour24(h)}
              />
            )}
          />
        ) : (
          <Grid
            items={HOURS_12}
            perRow={4}
            render={(h) => (
              <Cell
                label={String(h)}
                active={h === hour}
                onPress={() => commit12(h, minute, meridiem)}
              />
            )}
          />
        )}
      </Section>

      <Section title={t("Minute")}>
        <Grid
          items={MINUTE_STEPS}
          perRow={4}
          render={(m) => (
            <Cell
              label={m.toString().padStart(2, "0")}
              active={m === minute}
              onPress={() =>
                h24 ? onChange(hour24 * 60 + m) : commit12(hour, m, meridiem)
              }
            />
          )}
        />
      </Section>

      {!h24 && (
        <Grid
          items={[...MERIDIEMS]}
          perRow={2}
          render={(mer) => (
            <Cell
              label={t(mer)}
              active={mer === meridiem}
              onPress={() => commit12(hour, minute, mer)}
            />
          )}
        />
      )}

      <Button className="w-full" onPress={onDone}>
        <Text className="font-semibold text-primary-foreground">
          {t("Done")}
        </Text>
      </Button>
    </BottomSheetView>
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
  useLanguage();
  const bottomSheet = useBottomSheet();

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
      >
        <TimePickerBody
          title={sheetTitle ?? label}
          subtitle={subtitle}
          value={value}
          onChange={onChange}
          onDone={bottomSheet.close}
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
  useLanguage();
  const bottomSheet = useBottomSheet();

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
      >
        <TimePickerBody
          title={label}
          value={value}
          onChange={onChange}
          onDone={bottomSheet.close}
        />
      </BottomSheetContent>
    </BottomSheet>
  );
}
