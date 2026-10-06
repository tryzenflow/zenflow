import { Check, X } from "@/components/Icons";
import {
  BottomSheet,
  BottomSheetContent,
  BottomSheetView,
  useBottomSheet,
} from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useToast } from "@/components/ui/toast";
import {
  type DivergentSitting,
  pendingChoices,
  type SlotChose,
  type SlotPickChoice,
  type SlotPickResult,
} from "@/lib/series-alternatives";
import {
  buildSlotOptions,
  capitalize,
  type SlotOption,
} from "@/lib/slot-option";
import {
  getSlotTakenError,
  showErrorToast,
  showSlotTakenToast,
} from "@/lib/task-toasts";
import { zonedNow } from "@zenflow/core";
import * as Haptics from "expo-haptics";
import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export interface SeriesSlotPickInput {
  title: string;
  /**
   * ONLY the divergent sittings — never all N of a series. A plain task is a
   * one-sitting list (`singleSitting`), so one sheet serves both.
   */
  sittings: DivergentSitting[];
  tz: string;
  /**
   * Apply every choice in one batch and report which landed. A sitting that
   * can't be applied (a 409 SLOT_TAKEN when its alternative now overlaps a
   * sibling) goes in `failed`; the sheet reverts that card and stays open. Must
   * not reject for anything the user can act on.
   */
  onConfirm: (choices: SlotPickChoice[]) => Promise<SlotPickResult>;
}

interface SittingState {
  selected: SlotChose;
  /** What this sitting is recorded as; `primary` until a confirm lands. */
  committed: SlotChose;
  /**
   * Whether this sitting's proposal already has a recorded choice. A confirm
   * only sends undecided sittings: `POST /sessions/:id/slot-pick` treats a
   * second vote as a no-op echo, so re-sending would misreport the result.
   */
  decided: boolean;
}

interface CardPair {
  sitting: DivergentSitting;
  options: [SlotOption, SlotOption];
  state: SittingState;
}

/** Height of everything in the sheet except the list of sittings. */
const SHEET_CHROME = 310;

export interface SeriesSlotPickSheetHandle {
  open: (input: SeriesSlotPickInput) => void;
}

interface SeriesSlotPickSheetProps {
  tz: string;
}

/**
 * The alternative-slot picker for a single task (#41) and a multi-sitting
 * series (#59) — one sheet, one interaction.
 *
 * Everything is already scheduled at its primary when this shows, so the
 * primary starts selected and the sheet is an offer, not a gate. Tapping a card
 * only selects it, as does the small "Select all alternatives"; **Confirm**
 * then applies the sittings switched to their alternative in one batch (and
 * sends nothing at all when none were). Dismissing (X, or a scrim swipe) records nothing and keeps whatever is
 * scheduled.
 *
 * Every option prints its own DATE, not just a time: the two plans are
 * independent, so an alternative can land on a different day than the primary
 * it replaces, and a card showing only "9:00 AM" would read as a same-day
 * time-of-day tweak. A series surfaces at most `MAX_SERIES_ALTERNATIVES` (5)
 * divergent sittings and every one is listed, so the count in the header is
 * exactly what Confirm applies; the list scrolls.
 */
const SeriesSlotPickSheet = forwardRef<
  SeriesSlotPickSheetHandle,
  SeriesSlotPickSheetProps
>((_props, ref) => {
  const sheet = useBottomSheet();
  const { toast } = useToast();
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // Everything but the list (handle, heading, column titles, footer, padding)
  // is about this tall; the list gets the rest, so up to five sittings (the
  // most a series surfaces) fit without scrolling on a normal phone.
  const maxListHeight = Math.max(160, height - insets.top - insets.bottom - SHEET_CHROME);
  const [title, setTitle] = useState("");
  const [pairs, setPairs] = useState<CardPair[]>([]);
  const [busy, setBusy] = useState(false);

  // Non-null while the sheet is open with a confirm available. Doubles as the
  // idempotency guard: the web shim's `onDismiss` fires on ANY close
  // (bottom-sheet.tsx), so this is what keeps the dismiss path from running
  // after a confirm closed the sheet. `busyRef` is the single-flight guard —
  // `busy` state alone can let two taps in one tick both see `false`.
  const onConfirmRef = useRef<SeriesSlotPickInput["onConfirm"] | null>(null);
  const busyRef = useRef(false);

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
            // selected: the applied state is the safe one.
            state: { selected: "primary", committed: "primary", decided: false },
          })),
        );
        onConfirmRef.current = input.onConfirm;
        busyRef.current = false;
        setBusy(false);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
        sheet.open();
      },
    }),
    [sheet],
  );

  function closeSheet() {
    onConfirmRef.current = null;
    sheet.ref.current?.dismiss?.();
    sheet.close();
  }

  function select(pair: CardPair, chose: SlotChose) {
    if (busy || pair.state.decided || pair.state.selected === chose) return;
    setPairs((all) =>
      all.map((p) =>
        p === pair ? { ...p, state: { ...p.state, selected: chose } } : p,
      ),
    );
    Haptics.selectionAsync().catch(() => {});
  }

  /** Select the alternative for every sitting still open — nothing is sent until Confirm. */
  function selectAllAlternatives() {
    if (busy) return;
    setPairs((all) =>
      all.map((p) =>
        p.state.decided
          ? p
          : { ...p, state: { ...p.state, selected: "alternative" } },
      ),
    );
    Haptics.selectionAsync().catch(() => {});
  }

  /** Send the sittings switched to their alternative — and only those — in one batch. */
  async function confirm() {
    const onConfirm = onConfirmRef.current;
    if (!onConfirm || busyRef.current) return;
    const choices = pendingChoices(
      pairs.map((p) => ({
        id: p.sitting.session.id,
        decided: p.state.decided,
        selected: p.state.selected,
      })),
    );
    // Nothing switched to an alternative: nothing to update, so just close.
    if (choices.length === 0) {
      closeSheet();
      return;
    }

    busyRef.current = true;
    setBusy(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

    let result: SlotPickResult;
    try {
      result = await onConfirm(choices);
    } catch (error) {
      result = {
        appliedIds: [],
        failed: choices.map((c) => ({ id: c.sittingId, error })),
      };
    }

    const chosen = new Map(choices.map((c) => [c.sittingId, c.chose]));
    setPairs((all) =>
      all.map((p) => {
        const id = p.sitting.session.id;
        const chose = chosen.get(id);
        if (!chose) return p;
        return result.appliedIds.includes(id)
          ? {
              ...p,
              state: { selected: chose, committed: chose, decided: true },
            }
          : { ...p, state: { ...p.state, selected: p.state.committed } };
      }),
    );
    busyRef.current = false;
    setBusy(false);

    if (result.failed.length === 0) {
      closeSheet();
      return;
    }
    const taken = result.failed.some((f) => getSlotTakenError(f.error));
    if (taken) showSlotTakenToast(toast);
    else showErrorToast(toast, result.failed[0].error, "Couldn't update that");
  }

  /**
   * X, or a scrim swipe-away. Dismissal records nothing: untouched sittings
   * keep their already-applied primary slots, and already-confirmed ones stay
   * as confirmed.
   */
  function handleDismiss() {
    if (onConfirmRef.current === null || busyRef.current) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onConfirmRef.current = null;
    sheet.close();
  }

  const total = pairs[0]?.sitting.total ?? pairs.length;
  const single = total <= 1 && pairs.length === 1;
  const duration = pairs[0]?.sitting.session.durationMinutes;

  return (
    <BottomSheet>
      <BottomSheetContent ref={sheet.ref} onDismiss={handleDismiss}>
        <BottomSheetView hadHeader={false} className="px-5 pt-2">
          <View className="flex-row items-start justify-between gap-3">
            <View className="min-w-0 flex-1">
              <Text className="text-[18px] font-bold tracking-[-0.01em] leading-tight">
                {single ? "Two good times for this" : "Alternative times"}
              </Text>
              <Text className="text-[12.5px] text-muted-foreground mt-[3px]">
                {single
                  ? `${title} · ${duration}m`
                  : `${title} · ${pairs.length} of ${total} have alternatives`}
              </Text>
            </View>
            <Pressable
              onPress={handleDismiss}
              disabled={busy}
              accessibilityLabel="Close — keeps everything as scheduled"
              className="inline-flex size-8 items-center justify-center rounded-full bg-muted shrink-0"
            >
              <X size={15} className="text-muted-foreground" />
            </Pressable>
          </View>

          {/* Column headings, once, above every row — like the checklist's groups. */}
          <View className="flex-row gap-2 pt-6">
            <Text className="flex-1 px-1 text-[12px] font-medium text-muted-foreground">
              Scheduled
            </Text>
            <Text className="flex-1 px-1 text-[12px] font-medium text-muted-foreground">
              Alternative
            </Text>
          </View>

          {/* The sheet sizes itself to its content, so every sitting fits with no
              scrolling; the list only scrolls (capped here) on a short screen.
              A plain ScrollView on purpose: gorhom's `BottomSheetScrollView`
              reports ITS content height as the sheet's, so the sheet would size
              to the list alone and cut off the footer. */}
          <ScrollView
            style={{ maxHeight: maxListHeight }}
            nestedScrollEnabled
            contentContainerStyle={{ gap: 8, paddingTop: 6 }}
            showsVerticalScrollIndicator={false}
          >
            {pairs.map((pair) => (
              <View
                key={pair.sitting.session.id}
                className="flex-row items-stretch gap-2"
              >
                {pair.options.map((option) => {
                  const isSelected = pair.state.selected === option.kind;
                  return (
                    <Pressable
                      key={option.kind}
                      disabled={busy || pair.state.decided}
                      onPress={() => select(pair, option.kind)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: isSelected }}
                      accessibilityLabel={`${option.kind === "primary" ? "Scheduled" : "Alternative"} — ${option.label}`}
                      className={`flex-1 overflow-hidden rounded-xl border-2 px-3 py-3 ${isSelected ? "border-primary bg-primary/[0.08]" : "border-border bg-card"}`}
                    >
                      <View className="flex-row items-center gap-2">
                        <View
                          className={`size-[22px] shrink-0 items-center justify-center rounded-full border-[1.5px] ${isSelected ? "border-primary bg-primary" : "border-border bg-transparent"}`}
                        >
                          {isSelected ? (
                            <Check
                              size={13}
                              strokeWidth={3}
                              className="text-primary-foreground"
                            />
                          ) : null}
                        </View>
                        <Text
                          className="flex-1 text-[15px] font-semibold text-foreground"
                          numberOfLines={1}
                        >
                          {capitalize(option.day)}
                        </Text>
                      </View>
                      <Text
                        className="mt-1.5 text-[13px] text-muted-foreground"
                        numberOfLines={1}
                      >
                        {option.range}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </ScrollView>

          <Text className="pt-4 text-[12px] text-muted-foreground leading-snug">
            {single
              ? "Pick a time, then confirm."
              : "Pick a time for each, then confirm."}
          </Text>

          <View className="pt-3 flex-col gap-1">
            <Button
              size="lg"
              disabled={busy}
              accessibilityLabel="Confirm the selected times"
              className="w-full rounded-xl h-[48px]"
              onPress={() => void confirm()}
            >
              {busy ? (
                <ActivityIndicator
                  color="rgb(43, 20, 6)"
                  style={{ marginRight: 10 }}
                />
              ) : null}
              <Text className="font-bold">Confirm</Text>
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              accessibilityLabel={
                single
                  ? "Select the alternative time"
                  : "Select the alternative for every sitting"
              }
              className="w-full rounded-xl h-[40px]"
              onPress={selectAllAlternatives}
            >
              <Text className="text-[13px] font-medium text-muted-foreground">
                {single ? "Select the alternative" : "Select all alternatives"}
              </Text>
            </Button>
          </View>
        </BottomSheetView>
      </BottomSheetContent>
    </BottomSheet>
  );
});

SeriesSlotPickSheet.displayName = "SeriesSlotPickSheet";

export { SeriesSlotPickSheet };
