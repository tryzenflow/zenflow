import { listSessions } from "@/api/tasks";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { useLanguage } from "@/hooks/use-language";
import { importedTimetable } from "@/lib/imported-timetable";
import { format, t } from "@/lib/i18n";
import type { Session } from "@zenflow/shared";
import { useEffect, useState } from "react";
import { View } from "react-native";

/** Rows shown; the rest of the week stays on the calendar. */
const SHOW = 6;
/** The first sync runs in the background, so the week is re-read until it lands. */
const POLL_MS = 3000;
const MAX_ATTEMPTS = 10;

/**
 * The timetable an LMS or portal connect just imported, read from the current
 * week. Shown in onboarding right after a connect.
 */
export function ImportedTimetable() {
  useLanguage();
  // null while the first read (or a poll) is still empty.
  const [sessions, setSessions] = useState<Session[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const load = async (attempt: number) => {
      let found: Session[] = [];
      try {
        const week = await listSessions("week", new Date());
        found = importedTimetable(week.sessions, SHOW);
      } catch {
        // Retried below; a failed read is not a reason to stop.
      }
      if (cancelled) return;
      if (found.length > 0 || attempt >= MAX_ATTEMPTS) {
        setSessions(found);
        return;
      }
      timer = setTimeout(() => void load(attempt + 1), POLL_MS);
    };

    void load(1);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  return (
    <View className="mt-4 gap-2">
      <Text className="px-1 text-[13px] font-semibold text-muted-foreground">
        {t("Your timetable")}
      </Text>
      <View className="overflow-hidden rounded-2xl border border-border bg-card">
        {sessions === null ? (
          <View className="gap-2 px-4 py-3.5">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </View>
        ) : sessions.length === 0 ? (
          <Text className="px-4 py-3.5 text-[13.5px] text-muted-foreground">
            {t("No classes this week yet.")}
          </Text>
        ) : (
          sessions.map((session, index) => (
            <View
              key={session.id}
              className={index > 0 ? "border-t border-border px-4 py-3" : "px-4 py-3"}
            >
              <Text className="text-[14.5px] font-medium" numberOfLines={1}>
                {session.title}
              </Text>
              <Text
                className="mt-0.5 text-[12.5px] text-muted-foreground"
                numberOfLines={1}
              >
                {session.scheduledStartTime
                  ? format(new Date(session.scheduledStartTime), "EEE HH:mm")
                  : ""}
                {session.location ? `, ${session.location}` : ""}
              </Text>
            </View>
          ))
        )}
      </View>
    </View>
  );
}
