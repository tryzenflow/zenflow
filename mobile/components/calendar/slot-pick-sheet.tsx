import { Check, ChevronDown, X } from "@/components/Icons";
import {
  BottomSheet,
  BottomSheetContent,
  BottomSheetView,
  useBottomSheet,
} from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { zonedDate } from "@zenflow/core";
import type { Session } from "@zenflow/shared";
import { format } from "date-fns";
import * as Haptics from "expo-haptics";
import {
  type ComponentType,
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Pressable, View } from "react-native";

export interface SlotPickSheetHandle {
  open: (
    session: Session,
    primarySlot: string,
    alternativeSlot: string,
    slotProposalId: string,
    tz: string,
    onPick: (chose: "primary" | "alternative") => void,
    onDismiss: () => void,
  ) => void;
}

interface SlotPickSheetProps {
  tz: string;
}

interface Option {
  label: string;
  time: string;
  hint: string;
  isPrimary: boolean;
}

const SlotPickSheet = forwardRef<SlotPickSheetHandle, SlotPickSheetProps>(
  ({ tz }, ref) => {
    const sheet = useBottomSheet();
    const [session, setSession] = useState<Session | null>(null);
    const [primarySlot, setPrimarySlot] = useState("");
    const [alternativeSlot, setAlternativeSlot] = useState("");
    const [slotProposalId, setSlotProposalId] = useState("");
    const [options, setOptions] = useState<Option[]>([]);
    const [selected, setSelected] = useState<"primary" | "alternative" | null>(
      "alternative",
    );
    const onPickRef = useRef<
      ((chose: "primary" | "alternative") => void) | null
    >(null);
    const onDismissRef = useRef<(() => void) | null>(null);

    useImperativeHandle(
      ref,
      () => ({
        open: (
          nextSession,
          nextPrimarySlot,
          nextAlternativeSlot,
          nextSlotProposalId,
          nextTz,
          onPick,
          onDismiss,
        ) => {
          setSession(nextSession);
          setPrimarySlot(nextPrimarySlot);
          setAlternativeSlot(nextAlternativeSlot);
          setSlotProposalId(nextSlotProposalId);
          onPickRef.current = onPick;
          onDismissRef.current = onDismiss;

          const primaryDate = zonedDate(nextPrimarySlot, nextTz);
          const alternativeDate = zonedDate(nextAlternativeSlot, nextTz);

          setOptions([
            {
              label: format(primaryDate, "EEEE · h:mm a"),
              time: format(primaryDate, "h:mm a"),
              hint: "Currently scheduled",
              isPrimary: true,
            },
            {
              label: format(alternativeDate, "EEEE · h:mm a"),
              time: format(alternativeDate, "h:mm a"),
              hint: "Also fits before the deadline",
              isPrimary: false,
            },
          ]);
          setSelected("alternative");
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(
            () => {},
          );
          sheet.open();
        },
      }),
      [sheet],
    );

    function handlePick(chose: "primary" | "alternative") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      setSelected(chose);
      sheet.close();
      onPickRef.current?.(chose);
      onPickRef.current = null;
      onDismissRef.current = null;
    }

    function handleDismiss() {
      if (selected !== null) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      onPickRef.current?.("alternative");
      onPickRef.current = null;
      onDismissRef.current?.();
      onDismissRef.current = null;
    }

    return (
      <BottomSheet>
        <BottomSheetContent ref={sheet.ref} onDismiss={handleDismiss}>
          <BottomSheetView hadHeader={false} className="gap-2 pt-2">
            <View className="flex-row items-start justify-between gap-3 ">
              <View className="min-w-0 flex-1">
                <Text className="text-[18.5px] font-bold tracking-[-0.01em] leading-tight">
                  Two good times for this
                </Text>
                <Text className="text-[13px] text-muted-foreground mt-[3px]">
                  {session?.title ?? ""} · {session?.durationMinutes}m
                </Text>
              </View>
              <Pressable
                onPress={handleDismiss}
                accessibilityLabel="Dismiss — keeps the current time"
                className="inline-flex size-8 items-center justify-center rounded-full bg-muted shrink-0 "
              >
                <X size={15} className="text-muted-foreground" />
              </Pressable>
            </View>

            <View className="mt-4 flex flex-col gap-2.5">
              {options.map((option, index) => (
                <Pressable
                  key={option.isPrimary ? "primary" : "alternative"}
                  onPress={() => {
                    const chose = option.isPrimary
                      ? "primary"
                      : "alternative";
                    if (selected === chose) {
                      handlePick(chose);
                    } else {
                      setSelected(chose);
                      Haptics.selectionAsync().catch(() => {});
                    }
                  }}
                  className={`
                      text-left rounded-2xl border-2 px-4 py-5 flex flex-row items-center gap-3 my-0.5
                      ${
                        selected ===
                        (option.isPrimary ? "primary" : "alternative")
                          ? "border-primary bg-primary/[0.08]"
                          : "border-border bg-card"
                      }
                    `}
                >
                    <View
                      className={`
                    shrink-0 size-5 rounded-full border-2 flex items-center justify-center
                    ${
                      selected ===
                      (option.isPrimary ? "primary" : "alternative")
                        ? "bg-primary border-primary"
                        : "border-border bg-transparent"
                    }
                  `}
                    >
                      {selected ===
                        (option.isPrimary ? "primary" : "alternative") && (
                        <Check
                          size={12}
                          className="text-primary-foreground"
                          strokeWidth={4}
                        />
                      )}
                    </View>
                    <View className="min-w-0 flex-1">
                      <Text className="text-[15px] font-semibold">
                        {option.label}
                      </Text>
                      <Text className="text-[12px] text-muted-foreground mt-0.5">
                        {option.hint}
                      </Text>
                    </View>
                  </Pressable>
              ))}
            </View>

            <Text className="text-[13px] text-muted-foreground mt-3.5 leading-snug">
              Your pick helps Zenflow learn which times actually work for you —
              it never moves anything else on your calendar.
            </Text>

            <View className="flex-none pt-4 flex flex-col gap-2 mb-8">
              <Button
                size="lg"
                className="inline-flex w-full items-center justify-center gap-2 whitespace-nowrap rounded-xl h-[52px] px-5 text-base font-semibold shrink-0"
                onPress={() => handlePick("alternative")}
              >
                <Text className="font-bold">Switch to {options[1]?.time ?? ""}</Text>
              </Button>
              <Button
                variant="ghost"
                className="inline-flex w-full items-center justify-center rounded-xl h-[42px] px-5 text-[13.5px] font-semibold text-muted-foreground"
                onPress={() => handlePick("primary")}
              >
                <Text>Keep {options[0]?.time ?? ""}</Text>
              </Button>
            </View>
          </BottomSheetView>
        </BottomSheetContent>
      </BottomSheet>
    );
  },
);

SlotPickSheet.displayName = "SlotPickSheet";

export { SlotPickSheet };
