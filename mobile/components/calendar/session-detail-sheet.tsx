import { CheckOffButton } from "@/components/calendar/check-off-button";
import { SessionTypeBadge } from "@/components/calendar/session-type-badge";
import { localizedReminderLabel } from "@/components/tasks/composer/reminder-field";
import { NoteSkeleton } from "@/components/tasks/note-skeleton";
import {
  Bell,
  CalendarClock,
  Clock,
  type LucideIcon,
  MapPin,
  Pencil,
  Tag,
} from "@/components/Icons";
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
import { useCheckOff } from "@/hooks/use-check-off";
import { useCourseColourStore } from "@/hooks/use-course-colours";
import { useLanguage } from "@/hooks/use-language";
import { courseStyleFor } from "@/lib/course-colour";
import { placementReasonLine } from "@/lib/placement-reason";
import { format, formatTitle, localizedDeadlineShort, t } from "@/lib/i18n";
import { navigateOnce } from "@/lib/nav";
import {
  ANCHOR_LABEL_KEYS,
  SESSION_DETAIL_SNAP_POINTS,
  isFullSnap,
  sessionEditHref,
} from "@/lib/session-detail";
import { isNoteEmpty } from "@/lib/note-html";
import { type CheckState, checkStateOf } from "@/lib/today-summary";
import { useColorScheme } from "@/lib/useColorScheme";
import { zonedDate } from "@zenflow/core";
import type { Session } from "@zenflow/shared";
import { type Href, useRouter } from "expo-router";
import {
  type ReactNode,
  Suspense,
  forwardRef,
  lazy,
  useImperativeHandle,
  useState,
} from "react";
import { View } from "react-native";

// The note WebView (and its font loader) is only needed at full snap, so it is
// split out the same way the description editor is.
const SessionNote = lazy(() =>
  import("@/components/tasks/note/session-note").then((m) => ({
    default: m.SessionNote,
  })),
);

export interface SessionDetailSheetHandle {
  open: (session: Session) => void;
}

interface SessionDetailSheetProps {
  tz: string;
}

/** Start and end of a session in the user's timezone, e.g. `10:00 AM to 11:00 AM`. */
function timeRangeLabel(start: string, durationMinutes: number, tz: string): string {
  const end = new Date(new Date(start).getTime() + durationMinutes * 60_000);
  return t("{start} to {end}", {
    start: format(zonedDate(start, tz), "h:mm a"),
    end: format(zonedDate(end.toISOString(), tz), "h:mm a"),
  });
}

function DetailRow({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <View className="flex-row items-start gap-3">
      <View className="w-5 pt-0.5">
        <Icon size={16} className="text-muted-foreground" />
      </View>
      <View className="min-w-0 flex-1 gap-0.5">{children}</View>
    </View>
  );
}

/**
 * The session detail sheet a calendar block opens. It peeks at the details and
 * snaps to full for the note, which loads only once the sheet reaches full.
 * Check-off is the block's disc; Edit opens the composer for this session.
 */
export const SessionDetailSheet = forwardRef<SessionDetailSheetHandle, SessionDetailSheetProps>(
  ({ tz }, ref) => {
    useLanguage();
    const router = useRouter();
    const sheet = useBottomSheet();
    const checkOff = useCheckOff();
    const { isDarkColorScheme } = useColorScheme();
    const courseOverrides = useCourseColourStore((s) => s.overrides);
    const [session, setSession] = useState<Session | null>(null);
    const [checked, setChecked] = useState<CheckState | null>(null);
    const [noteMounted, setNoteMounted] = useState(false);

    useImperativeHandle(
      ref,
      () => ({
        open: (next) => {
          setSession(next);
          setChecked(null);
          setNoteMounted(false);
          sheet.open();
        },
      }),
      [sheet],
    );

    const handleSnapChange = (index: number) => {
      if (isFullSnap(index)) setNoteMounted(true);
    };

    const onToggle = async (next: "done" | "open"): Promise<boolean> => {
      if (!session) return false;
      const ok = await checkOff({ id: session.id, title: session.title }, "complete", next === "done");
      if (ok) setChecked(next === "done" ? "done" : "open");
      return ok;
    };

    const edit = () => {
      if (!session) return;
      const href = sessionEditHref(session.id);
      sheet.close();
      // Let the sheet finish dismissing before the composer modal mounts.
      setTimeout(() => navigateOnce(() => router.push(href as Href)), 180);
    };

    const state: CheckState = session ? (checked ?? checkStateOf(session)) : "open";
    const stripe = session?.courseKey
      ? courseStyleFor(session.courseKey, courseOverrides, isDarkColorScheme ? "dark" : "light")?.stripe
      : undefined;
    const hasNote = !!session?.note && !isNoteEmpty(session.note);
    const reasonLine =
      session?.scheduledStartTime && session.placementReason
        ? placementReasonLine(session.placementReason, session.scheduledStartTime, tz)
        : null;

    return (
      <BottomSheet>
        <BottomSheetContent
          ref={sheet.ref}
          snapPoints={SESSION_DETAIL_SNAP_POINTS}
          enableDynamicSizing={false}
          onChange={handleSnapChange}
        >
          {session && (
            <>
              <BottomSheetHeader className="items-start gap-3 border-b-0 pb-2">
                <CheckOffButton state={state} title={session.title} onToggle={onToggle} />
                <View className="min-w-0 flex-1 gap-1.5">
                  {stripe && (
                    <View
                      testID="session-detail-stripe"
                      className="h-1 w-8 rounded-full"
                      style={{ backgroundColor: stripe }}
                    />
                  )}
                  <View className="flex-row flex-wrap items-center gap-2">
                    <SessionTypeBadge type={session.type} size="lg" />
                    {session.type === "TASK" && (
                      <Text className="text-[13px] text-muted-foreground">
                        {t(ANCHOR_LABEL_KEYS[session.anchor])}
                      </Text>
                    )}
                  </View>
                  <Text
                    testID="session-detail-title"
                    className="text-[20px] font-bold leading-tight tracking-tight"
                    numberOfLines={2}
                  >
                    {session.title}
                  </Text>
                </View>
              </BottomSheetHeader>

              <BottomSheetScrollView>
                <BottomSheetView className="gap-4 pb-4 pt-2">
                  <DetailRow icon={Clock}>
                    {session.scheduledStartTime ? (
                      <>
                        <Text className="text-[15px] font-medium">
                          {timeRangeLabel(session.scheduledStartTime, session.durationMinutes, tz)}
                        </Text>
                        <Text className="text-[13px] text-muted-foreground">
                          {formatTitle(zonedDate(session.scheduledStartTime, tz), "EEE MMM d")}
                        </Text>
                        {reasonLine && (
                          <Text testID="session-detail-reason" className="text-[13px] text-muted-foreground">
                            {reasonLine}
                          </Text>
                        )}
                      </>
                    ) : (
                      <Text className="text-[15px] text-muted-foreground">{t("Not scheduled yet")}</Text>
                    )}
                  </DetailRow>

                  {session.deadline && (
                    <DetailRow icon={CalendarClock}>
                      <Text className="text-[15px]">
                        {t("Due {date}", {
                          date: localizedDeadlineShort(session.deadline, tz, new Date()),
                        })}
                      </Text>
                    </DetailRow>
                  )}

                  {session.location && (
                    <DetailRow icon={MapPin}>
                      <Text className="text-[15px]">{session.location}</Text>
                    </DetailRow>
                  )}

                  {session.tags.length > 0 && (
                    <DetailRow icon={Tag}>
                      <View className="flex-row flex-wrap gap-1.5 pt-0.5">
                        {session.tags.map((tag) => (
                          <View
                            key={tag}
                            className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5"
                          >
                            <Text className="text-[13px] font-semibold text-primary">{tag}</Text>
                          </View>
                        ))}
                      </View>
                    </DetailRow>
                  )}

                  {session.reminders.length > 0 && (
                    <DetailRow icon={Bell}>
                      <Text className="text-[15px]">
                        {session.reminders.map(localizedReminderLabel).join(", ")}
                      </Text>
                    </DetailRow>
                  )}

                  {hasNote && (
                    <View className="gap-2">
                      <Text className="text-[13px] font-semibold text-muted-foreground">{t("Notes")}</Text>
                      {noteMounted && session.note ? (
                        <Suspense fallback={<NoteSkeleton />}>
                          <SessionNote html={session.note} />
                        </Suspense>
                      ) : (
                        <Text className="text-[14px] text-muted-foreground">
                          {t("Swipe up to read the note")}
                        </Text>
                      )}
                    </View>
                  )}
                </BottomSheetView>
              </BottomSheetScrollView>

              <BottomSheetView className="pb-4 pt-1">
                <Button onPress={edit} className="w-full">
                  <Pencil size={16} className="text-primary-foreground" />
                  <Text className="text-[15px] font-semibold text-primary-foreground">{t("Edit")}</Text>
                </Button>
              </BottomSheetView>
            </>
          )}
        </BottomSheetContent>
      </BottomSheet>
    );
  },
);

SessionDetailSheet.displayName = "SessionDetailSheet";
