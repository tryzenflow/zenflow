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
import {
  buildSlotOptions,
  capitalize,
  type SlotOption,
} from "@/lib/slot-option";
import {
  undecidedSittingIds,
  type DivergentSitting,
} from "@/lib/series-alternatives";
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
  onBulk: (
    chose: Chose,
    sittingIds: string[],
  ) => Promise<{ appliedIds: string[]; failedIds: string[] }>;
}

interface SittingState {
  selected: Chose;
  committed: Chose;
  /**
   * Whether this sitting's proposal already has a recorded choice.
   * `committed === "primary"` alone cannot identify bulk targets: it holds
   * both for untouched sittings and for ones explicitly kept at primary, so
   * bulk actions filter on `decided` instead (Option A — undecided only).
   */
  decided: boolean;
  busy: boolean;
}

interface BulkResult {
  appliedIds: string[];
  failedIds: string[];
}

interface CardPair {
  sitting: DivergentSitting;
  options: [SlotOption, SlotOption];
  state: SittingState;
}

const emptyBulkResult: BulkResult = { appliedIds: [], failedIds: [] };

function updatePair(pair: CardPair, state: Partial<SittingState>): CardPair {
  return { ...pair, state: { ...pair.state, ...state } };
}

function updatePairs(
  pairs: CardPair[],
  id: string,
  state: Partial<SittingState>,
): CardPair[] {
  return pairs.map((pair) =>
    pair.sitting.session.id === id ? updatePair(pair, state) : pair,
  );
}

export interface SeriesSlotPickSheetHandle {
  open: (input: SeriesSlotPickInput) => void;
}

interface SeriesSlotPickSheetProps {
  tz: string;
}

/**
 * The multi-sitting alternative-slot picker (issue #59).
 *
 * A `sessionCount > 1` TASK series is entirely scheduled the moment it is
 * created — this is never a gate before that. It only surfaces the sittings
 * where the heuristic and LinUCB disagreed, and lets each one be swapped
 * independently. The mobile picker shows at most the three soonest divergent
 * sittings, so this is always a short scroll rather than all N sittings.
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
            state: {
              selected: "primary",
              committed: "primary",
              decided: false,
              busy: false,
            },
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

  /** Apply one sitting's pick without allowing a second mutation for that
   * sitting to overlap the first. */
  async function commit(sitting: DivergentSitting, chose: Chose) {
    const id = sitting.session.id;
    const current = pairs.find((pair) => pair.sitting.session.id === id);
    if (!current || current.state.busy || bulkBusy) return;
    setPairs((p) => updatePairs(p, id, { busy: true }));
    try {
      await onPickRef.current?.(id, chose);
      setPairs((p) =>
        updatePairs(p, id, {
          selected: chose,
          committed: chose,
          decided: true,
          busy: false,
        }),
      );
      closeSheet();
    } catch (e) {
      if (getSlotTakenError(e)) {
        showSlotTakenToast(toast);
      } else {
        showErrorToast(toast, e, "Couldn't move that sitting");
      }
      setPairs((p) =>
        updatePairs(p, id, {
          selected: current.state.committed,
          committed: current.state.committed,
          busy: false,
        }),
      );
    }
  }

  function select(pair: CardPair, chose: Chose) {
    if (pair.state.busy || bulkBusy) return;
    if (pair.state.selected === chose) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      void commit(pair.sitting, chose);
      return;
    }
    setPairs((p) =>
      updatePairs(p, pair.sitting.session.id, { selected: chose }),
    );
    Haptics.selectionAsync().catch(() => {});
  }

  /** Apply a bulk decision and keep failed cards at their committed state. */
  function closeSheet() {
    onPickRef.current = null;
    onBulkRef.current = null;
    sheet.ref.current?.dismiss?.();
    sheet.close();
  }

  async function bulk(chose: Chose) {
    if (bulkBusy || pairs.some((pair) => pair.state.busy)) return;
    const targets = undecidedSittingIds(
      pairs.map((pair) => ({
        id: pair.sitting.session.id,
        decided: pair.state.decided,
      })),
    );

    if (targets.length === 0) {
      closeSheet();
      return;
    }
    setBulkBusy(true);
    setPairs((p) =>
      p.map((pair) =>
        targets.includes(pair.sitting.session.id)
          ? updatePair(pair, { busy: true })
          : pair,
      ),
    );
    let result = emptyBulkResult;
    try {
      result = (await onBulkRef.current?.(chose, targets)) ?? {
        appliedIds: [],
        failedIds: targets,
      };
    } catch {
      result = { appliedIds: [], failedIds: targets };
    }
    setPairs((p) =>
      p.map((pair) => {
        if (!targets.includes(pair.sitting.session.id)) return pair;
        const id = pair.sitting.session.id;
        if (result.appliedIds.includes(id)) {
          return updatePair(pair, {
            selected: chose,
            committed: chose,
            decided: true,
            busy: false,
          });
        }
        return updatePair(pair, {
          selected: pair.state.committed,
          busy: false,
        });
      }),
    );
    setBulkBusy(false);
    if (result.appliedIds.length === targets.length) {
      closeSheet();
    }
  }

  /**
   * X, or a scrim swipe-away. Dismissal records nothing: untouched sittings
   * keep their already-applied primary slots by default, and already-moved
   * sittings stay moved (`POST /sessions/:id/slot-pick` is a one-shot record,
   * so a second "primary" vote would be a no-op, never a move-back).
   */
  function handleDismiss() {
    if (
      onPickRef.current === null ||
      bulkBusy ||
      pairs.some((pair) => pair.state.busy)
    ) {
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onPickRef.current = null;
    onBulkRef.current = null;
    sheet.close();
  }

  const onPrimary = pairs.filter(
    (pair) => pair.state.committed === "primary",
  ).length;
  const total = pairs[0]?.sitting.total ?? pairs.length;

  return (
    <BottomSheet>
      <BottomSheetContent
        ref={sheet.ref}
        onDismiss={handleDismiss}
        snapPoints={["65%"]}
        enableDynamicSizing={false}
      >
        <View className="flex-1 flex-col">
          <BottomSheetScrollView
            className="flex-1 px-5"
            contentContainerStyle={{ paddingBottom: 16 }}
          >
            <View className="w-full pt-2">
              <View className="flex-row items-start justify-between gap-3">
                <View className="min-w-0 flex-1">
                  <Text className="text-[17px] font-bold tracking-[-0.01em] leading-tight">
                    Alternative times
                  </Text>
                  <Text className="text-[12px] text-muted-foreground mt-[3px]">
                    {title} · {pairs.length} of {total} sittings have an
                    alternative
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
            </View>

            <View className="gap-1 pt-7">
              {pairs.slice(0, 3).map((pair) => (
                <View
                  key={pair.sitting.session.id}
                  className="flex-row items-start gap-2 shrink-0"
                  style={{ minHeight: 69 }}
                >
                  {pair.options.map((option) => {
                    const isSelected = pair.state.selected === option.kind;
                    return (
                      <Pressable
                        key={option.kind}
                        disabled={pair.state.busy || bulkBusy}
                        onPress={() => select(pair, option.kind)}
                        accessibilityLabel={`${option.kind === "primary" ? "Scheduled" : "Alternative"} — ${option.label}`}
                        className={`flex-1 overflow-hidden rounded-lg border-2 px-2.5 py-3 ${isSelected ? "border-primary bg-primary/[0.08]" : "border-border bg-card"}`}
                      >
                        <View className="flex-row items-center gap-1.5">
                          <View
                            className={`size-5 shrink-0 items-center justify-center rounded-full border-2 ${isSelected ? "border-primary bg-primary" : "border-muted-foreground/40 bg-transparent"}`}
                          >
                            {isSelected ? (
                              <Check
                                size={12}
                                strokeWidth={3.5}
                                className="text-primary-foreground"
                              />
                            ) : null}
                          </View>
                          <Text
                            className="flex-1 text-[10.5px] font-semibold text-muted-foreground"
                            numberOfLines={2}
                          >
                            {capitalize(option.day)} ·{" "}
                            {option.kind === "primary"
                              ? "Scheduled"
                              : "Alternative"}
                          </Text>
                        </View>
                        <Text
                          className="mt-1 pl-[26px] text-[13px] font-semibold"
                          numberOfLines={1}
                        >
                          {option.range}
                        </Text>
                        {/* {option.dayDelta ? (
                          <Text className="text-[10px] font-semibold text-primary mt-0.5">
                            {option.dayDelta}
                          </Text>
                        ) : null} */}
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </View>
          </BottomSheetScrollView>

          <View className="shrink-0 px-5 pt-6 pb-6">
            <Text className="text-[10.5px] text-muted-foreground leading-snug">
              Tap an alternative to swap that sitting — applied right away.
            </Text>

            <View className="pt-3 flex-col gap-2">
              <Button
                size="lg"
                disabled={bulkBusy || onPrimary === 0}
                accessibilityLabel="Switch every undecided sitting to its alternative"
                className="w-full rounded-xl h-[46px]"
                onPress={() => void bulk("alternative")}
              >
                {bulkBusy ? <ActivityIndicator color="#fff" /> : null}
                <Text className="font-bold">
                  {onPrimary === 0
                    ? "All switched"
                    : "Switch all to alternatives"}
                </Text>
              </Button>
              <Button
                variant="ghost"
                disabled={bulkBusy}
                accessibilityLabel="Keep every undecided sitting where it is scheduled"
                className="w-full rounded-xl h-[38px]"
                onPress={() => void bulk("primary")}
              >
                <Text className="font-semibold text-muted-foreground">
                  Keep all as scheduled
                </Text>
              </Button>
            </View>
          </View>
        </View>
      </BottomSheetContent>
    </BottomSheet>
  );
});

SeriesSlotPickSheet.displayName = "SeriesSlotPickSheet";

export { SeriesSlotPickSheet };
