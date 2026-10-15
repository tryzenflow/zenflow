import { Clock, Hand, Lock } from "@/components/Icons";
import {
  BottomSheet,
  BottomSheetContent,
  BottomSheetHeader,
  BottomSheetScrollView,
  BottomSheetView,
  useBottomSheet,
} from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useLanguage } from "@/hooks/use-language";
import { format, t } from "@/lib/i18n";
import { type RoomRow, roomTimelines } from "@/lib/make-room";
import { zonedDate } from "@zenflow/core";
import type { PlacementPlan, Session } from "@zenflow/shared";
import { forwardRef, useImperativeHandle, useState } from "react";
import { View } from "react-native";

/** One button in the sheet. The sheet closes first, then `run` is called. */
export interface MakeRoomAction {
  id: string;
  label: string;
  variant?: "default" | "outline" | "ghost";
  run: () => void | Promise<void>;
}

export interface MakeRoomRequest {
  /** The sheet's one-line subtitle, already translated. */
  subtitle: string;
  plan: PlacementPlan;
  /** Title and length of the session being placed, when the plan creates it. */
  title: string;
  durationMinutes: number;
  /** Sessions the plan moves, for their titles and lengths. */
  sessions: Session[];
  actions: MakeRoomAction[];
}

export interface MakeRoomSheetHandle {
  open: (request: MakeRoomRequest) => void;
}

interface MakeRoomSheetProps {
  tz: string;
}

function timeOf(iso: string, tz: string): string {
  return format(zonedDate(iso, tz), "h:mm a");
}

function TimelineRow({ row, tz }: { row: RoomRow; tz: string }) {
  const Icon = row.moved ? Clock : Hand;
  const end = new Date(new Date(row.start).getTime() + row.durationMinutes * 60_000);
  return (
    <View
      testID={`make-room.row.${row.id}`}
      className={
        row.moved
          ? "flex-row items-center gap-3 rounded-xl border border-border bg-muted/40 px-3 py-2.5"
          : "flex-row items-center gap-3 rounded-xl border border-primary/40 bg-primary/10 px-3 py-2.5"
      }
    >
      <Icon size={16} className={row.moved ? "text-muted-foreground" : "text-primary"} />
      <View className="min-w-0 flex-1">
        <Text numberOfLines={1} className="text-[14px] font-semibold">
          {row.title || t("Session")}
        </Text>
        <Text className="text-[12px] text-muted-foreground">
          {t("{start} to {end}", {
            start: timeOf(row.start, tz),
            end: timeOf(end.toISOString(), tz),
          })}
        </Text>
      </View>
    </View>
  );
}

function Timeline({
  label,
  rows,
  tz,
  testID,
}: {
  label: string;
  rows: RoomRow[];
  tz: string;
  testID: string;
}) {
  return (
    <View testID={testID} className="gap-2">
      <Text className="text-[13px] font-semibold text-muted-foreground">{label}</Text>
      {rows.map((row) => (
        <TimelineRow key={`${row.id}-${row.start}`} row={row} tz={tz} />
      ))}
    </View>
  );
}

/**
 * The Make room sheet: a placement that moves a `CHOSEN` session needs the
 * user's go-ahead. It shows the timeline before and after the plan, then the
 * caller's actions. Nothing is applied until an action runs.
 */
export const MakeRoomSheet = forwardRef<MakeRoomSheetHandle, MakeRoomSheetProps>(
  ({ tz }, ref) => {
    useLanguage();
    const sheet = useBottomSheet();
    const [request, setRequest] = useState<MakeRoomRequest | null>(null);

    useImperativeHandle(
      ref,
      () => ({
        open: (next) => {
          setRequest(next);
          sheet.open();
        },
      }),
      [sheet],
    );

    const run = (action: MakeRoomAction) => {
      sheet.close();
      // Let the sheet finish dismissing before the action opens anything else.
      setTimeout(() => void action.run(), 180);
    };

    const timelines = request
      ? roomTimelines(request.plan, request.sessions, request.title, request.durationMinutes)
      : null;

    return (
      <BottomSheet>
        <BottomSheetContent ref={sheet.ref} snapPoints={["88%"]} enableDynamicSizing={false}>
          {request && timelines && (
            <>
              <BottomSheetHeader className="items-start gap-1 border-b-0 pb-2">
                <Text testID="make-room-title" className="text-[20px] font-bold tracking-tight">
                  {t("Make room")}
                </Text>
                <Text className="text-[13px] text-muted-foreground">{request.subtitle}</Text>
              </BottomSheetHeader>

              <BottomSheetScrollView>
                <BottomSheetView className="gap-5 pb-4 pt-2">
                  <Timeline
                    testID="make-room-before"
                    label={t("Before")}
                    rows={timelines.before}
                    tz={tz}
                  />
                  <Timeline
                    testID="make-room-after"
                    label={t("After")}
                    rows={timelines.after}
                    tz={tz}
                  />
                  <View className="flex-row items-center gap-2">
                    <Lock size={12} className="text-muted-foreground" />
                    <Text className="text-[12px] text-muted-foreground">
                      {t("Pinned and fixed sessions never move.")}
                    </Text>
                  </View>
                </BottomSheetView>
              </BottomSheetScrollView>

              <BottomSheetView className="gap-2 pb-4 pt-1">
                {request.actions.map((action) => (
                  <Button
                    key={action.id}
                    testID={`make-room.${action.id}`}
                    variant={action.variant ?? "default"}
                    onPress={() => run(action)}
                    className="w-full"
                  >
                    <Text
                      className={
                        (action.variant ?? "default") === "default"
                          ? "text-[15px] font-semibold text-primary-foreground"
                          : "text-[15px] font-semibold text-foreground"
                      }
                    >
                      {action.label}
                    </Text>
                  </Button>
                ))}
              </BottomSheetView>
            </>
          )}
        </BottomSheetContent>
      </BottomSheet>
    );
  },
);

MakeRoomSheet.displayName = "MakeRoomSheet";
