import { Check, X } from "@/components/Icons";
import {
  BottomSheet,
  BottomSheetContent,
  BottomSheetScrollView,
  BottomSheetView,
  useBottomSheet,
} from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useToast } from "@/components/ui/toast";
import { buildSlotOptions, type SlotOption } from "@/lib/slot-option";
import type { DivergentSitting } from "@/lib/series-alternatives";
import {
  getSlotTakenError,
  showErrorToast,
  showSlotTakenToast,
} from "@/lib/task-toasts";
import { zonedNow } from "@zenflow/core";
import * as Haptics from "expo-haptics";
import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";

/** Which side of a sitting's comparison was chosen. Mirrors `SlotPickRequest`
 * `["chose"]` in @zenflow/shared. */
type Chose = "primary" | "alternative";

export interface SeriesSlotPickInput {
  title: string;
  /** ONLY the divergent sittings — never all N of the series. */
  sittings: DivergentSitting[];
  tz: string;
  /**
   * Apply one sitting's pick. Rejects on a 409 SLOT_TAKEN when the alternative
   * now overlaps a sibling that moved; the sheet reverts that one card and
   * stays open. Must not reject for anything the user can act on.
   */
  onPick: (sittingId: string, chose: Chose) => Promise<void>;
  /** Apply a decision to every still-undecided sitting, in one pass. */
  onBulk: (chose: Chose, sittingIds: string[]) => Promise<void>;
}

export interface SeriesSlotPickSheetHandle {
  open: (input: SeriesSlotPickInput) => void;
}

interface SeriesSlotPickSheetProps {
  tz: string;
}

/** One sitting's two cards plus its own selection and in-flight flag. */
interface CardPair {
  sitting: DivergentSitting;
  options: [SlotOption, SlotOption];
  selected: Chose;
  busy: boolean;
}

/**
 * The multi-sitting alternative-slot picker (issue #59).
 *
 * A `sessionCount > 1` TASK series is entirely scheduled the moment it is
 * created — this is never a gate before that. It only surfaces the sittings
 * where the heuristic and LinUCB disagreed, and lets each one be swapped
 * independently. `MAX_SERIES_ALTERNATIVES` (5) bounds the list server-side, so
 * this is always a short scroll rather than all N sittings.
 *
 * Every option prints its own DATE, not just a time: the two plans are
 * independent, so an alternative can land on a different day than the primary
 * it replaces, and a card showing only "9:00 AM" would read as a same-day
 * time-of-day tweak.
 *
 * Deliberately identical in feel to `SlotPickSheet` (#41) — same imperative
 * handle, same two-click select-then-commit cards, same dismiss-records-a-pick
 * semantics — so the two are not two different interactions.
 */
const SeriesSlotPickSheet = forwardRef<
  SeriesSlotPickSheetHandle,
  SeriesSlotPickSheetProps
>(({ tz }, ref) => {
  const sheet = useBottomSheet();
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [pairs, setPairs] = useState<CardPair[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);

  // Non-null while a pick is in flight. Doubles as the idempotency guard: the
  // web shim's `onDismiss` fires on ANY close (bottom-sheet.tsx), and a
  // committed pick does not close the sheet, so the guard is what keeps the
  // dismiss path from firing twice.
  const onPickRef = useRef<SeriesSlotPickInput["onPick"] | null>(null);
  const onBulkRef = useRef<SeriesSlotPickInput["onBulk"] | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      open: (input) => {
        const now = zonedNow(input.tz);
        setTitle(input.title);
        setPairs(
          input.sittings.map((sitting) => ({
            sitting,
            options: buildSlotOptions(
              {
                primarySlot: sitting.primarySlot,
                alternativeSlot: sitting.alternativeSlot,
                durationMinutes: sitting.session.durationMinutes,
              },
              input.tz,
              now,
            ),
            // The primary is what the server already applied, so it starts
            // selected. Note this is the OPPOSITE of SlotPickSheet's
            // "alternative" default — here the applied state is the safe one.
            selected: "primary" as Chose,
            busy: false,
          })),
        );
        onPickRef.current = input.onPick;
        onBulkRef.current = input.onBulk;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
        sheet.open();
      },
    }),
    [sheet],
  );

  const setBusy = (id: string, busy: boolean) =>
    setPairs((p) =>
      p.map((c) => (c.sitting.session.id === id ? { ...c, busy } : c)),
    );

  const setSelected = (id: string, selected: Chose) =>
    setPairs((p) =>
      p.map((c) => (c.sitting.session.id === id ? { ...c, selected } : c)),
    );

  /**
   * Apply one sitting's pick. Never throws — a failure must not unwind the
   * create or redistribute that already succeeded, and the user keeps their
   * other picks.
   */
  async function commit(sitting: DivergentSitting, chose: Chose) {
    const id = sitting.session.id;
    setBusy(id, true);
    try {
      await onPickRef.current?.(id, chose);
      setSelected(id, chose);
    } catch (e) {
      if (getSlotTakenError(e)) {
        // The server kept the primary — say so, and reflect it on the card.
        showSlotTakenToast(toast);
        setSelected(id, "primary");
      } else {
        showErrorToast(toast, e, "Couldn't move that sitting");
      }
    } finally {
      setBusy(id, false);
    }
  }

  /**
   * Two-click select-then-commit, matching SlotPickSheet: the first tap only
   * moves the selection, the second on the same card commits. The bulk buttons
   * below are the one-tap path.
   */
  function select(pair: CardPair, chose: Chose) {
    if (pair.busy) return;
    if (pair.selected === chose) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      void commit(pair.sitting, chose);
    } else {
      setSelected(pair.sitting.session.id, chose);
      Haptics.selectionAsync().catch(() => {});
    }
  }

  /**
   * "Switch all" / "Keep all" — only the sittings not already decided, so a
   * re-tap can never re-POST a pick that already landed. The caller fans out
   * with `Promise.allSettled`, so one 409 leaves the rest applied.
   */
  async function bulk(chose: Chose) {
    const targets = pairs
      .filter((c) => c.selected !== chose)
      .map((c) => c.sitting.session.id);
    if (targets.length === 0) return;
    setBulkBusy(true);
    try {
      await onBulkRef.current?.(chose, targets);
      setPairs((p) =>
        p.map((c) =>
          targets.includes(c.sitting.session.id) ? { ...c, selected: chose } : c,
        ),
      );
    } finally {
      setBulkBusy(false);
    }
  }

  /**
   * X, or a scrim swipe-away. A sitting left on its alternative has been
   * reported as moved, so on dismiss those re-assert the already-applied
   * primary — which is also what records the pick as "kept".
   */
  function handleDismiss() {
    if (onPickRef.current === null) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const moved = pairs
      .filter((c) => c.selected === "alternative")
      .map((c) => c.sitting.session.id);
    if (moved.length > 0) void onBulkRef.current?.("primary", moved);
    onPickRef.current = null;
    onBulkRef.current = null;
    sheet.close();
  }

  // How many sittings are still on their already-applied primary — the bulk
  // "switch all" target count, and the number behind the header copy.
  const onPrimary = pairs.filter((c) => c.selected === "primary").length;
  const total = pairs[0]?.sitting.total ?? pairs.length;

  return (
    <BottomSheet>
      <BottomSheetContent ref={sheet.ref} onDismiss={handleDismiss}>
        <BottomSheetView hadHeader={false} className="gap-2 pt-2 px-5">
          <View className="flex-row items-start justify-between gap-3">
            <View className="min-w-0 flex-1">
              <Text className="text-[17px] font-bold tracking-[-0.01em] leading-tight">
                Alternative times
              </Text>
              <Text className="text-[12px] text-muted-foreground mt-[3px]">
                {title} · {pairs.length} of {total} sittings have an alternative
              </Text>
            </View>
            <Pressable
              onPress={handleDismiss}
              accessibilityLabel="Close — keeps everything as scheduled"
              className="inline-flex size-8 items-center justify-center rounded-full bg-muted shrink-0"
            >
              <X size={15} className="text-muted-foreground" />
            </Pressable>
          </View>
        </BottomSheetView>

        <BottomSheetScrollView
          className="px-5"
          contentContainerStyle={{ paddingTop: 12, paddingBottom: 8, gap: 10 }}
        >
          {pairs.map((pair) => (
            <View key={pair.sitting.session.id} className="flex-row gap-2">
              {pair.options.map((option) => {
                const isSelected = pair.selected === option.kind;
                return (
                  <Pressable
                    key={option.kind}
                    disabled={pair.busy}
                    onPress={() => select(pair, option.kind)}
                    accessibilityLabel={`${option.kind === "primary" ? "Scheduled" : "Alternative"} — ${option.label}`}
                    className={`
                        flex-1 rounded-lg border-2 px-2.5 py-2
                        ${isSelected ? "border-primary bg-primary/[0.08]" : "border-border bg-card"}
                      `}
                  >
                    <View className="flex-row items-center gap-1.5">
                      <View
                        className={`
                            size-3.5 shrink-0 rounded-full border-2 items-center justify-center
                            ${isSelected ? "bg-primary border-primary" : "border-border"}
                          `}
                      >
                        {isSelected ? (
                          <Check
                            size={8}
                            strokeWidth={3.5}
                            className="text-primary-foreground"
                          />
                        ) : null}
                      </View>
                      <Text
                        className="text-[10.5px] font-semibold text-muted-foreground flex-1"
                        numberOfLines={1}
                      >
                        {option.day} ·{" "}
                        {option.kind === "primary" ? "Scheduled" : "Alternative"}
                      </Text>
                    </View>
                    <Text
                      className="text-[13px] font-semibold mt-1 pl-5"
                      numberOfLines={1}
                    >
                      {option.time}
                    </Text>
                    {option.dayDelta ? (
                      <Text className="text-[10px] font-semibold text-primary mt-0.5 pl-5">
                        {option.dayDelta}
                      </Text>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          ))}
        </BottomSheetScrollView>

        <BottomSheetView hadHeader={false} className="px-5 pt-2 pb-1">
          <Text className="text-[10.5px] text-muted-foreground leading-snug">
            Tap an alternative to swap that sitting — applied right away.
          </Text>
        </BottomSheetView>

        <BottomSheetView hadHeader={false} className="px-5 pt-2 pb-6 flex-col gap-2">
          <Button
            size="lg"
            disabled={bulkBusy || onPrimary === 0}
            accessibilityLabel="Switch every undecided sitting to its alternative"
            className="inline-flex w-full items-center justify-center gap-2 whitespace-nowrap rounded-xl h-[46px] px-5 text-[14.5px] font-semibold shrink-0"
            onPress={() => void bulk("alternative")}
          >
            {bulkBusy ? <ActivityIndicator color="#fff" /> : null}
            <Text className="font-bold">
              {onPrimary === 0 ? "All switched" : "Switch all to alternatives"}
            </Text>
          </Button>
          <Button
            variant="ghost"
            disabled={bulkBusy || onPrimary === pairs.length}
            accessibilityLabel="Keep every undecided sitting where it is scheduled"
            className="inline-flex w-full items-center justify-center rounded-xl h-[38px] px-5 text-[13px] font-semibold text-muted-foreground"
            onPress={() => void bulk("primary")}
          >
            <Text className="font-semibold">Keep all as scheduled</Text>
          </Button>
        </BottomSheetView>
      </BottomSheetContent>
    </BottomSheet>
  );
});

SeriesSlotPickSheet.displayName = "SeriesSlotPickSheet";

export { SeriesSlotPickSheet };
