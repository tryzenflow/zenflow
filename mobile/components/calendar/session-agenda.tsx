import { searchSessions } from "@/api/tasks";
import {
  DayHeaderSkeleton,
  SessionRowSkeleton,
} from "@/components/calendar/session-row-skeleton";
import { Text } from "@/components/ui/text";
import { useAfterPaint } from "@/hooks/use-after-paint";
import { useDelayedLoading } from "@/hooks/use-delayed-loading";
import { useUserStore } from "@/hooks/use-user-store";
import { highlightParts } from "@/lib/highlight";
import { t } from "@/lib/i18n";
import { navigateOnce } from "@/lib/nav";
import {
  dayLabel,
  flattenDayGroups,
  groupSessionsByDay,
  mergeSearchPage,
  type SearchListRow,
  sessionTimeRange,
} from "@/lib/session-search-list";
import { useTabBarOverlayHeight } from "@/lib/tab-bar-metrics";
import { deriveState, SESSION_TONES, sessionTone } from "@zenflow/core";
import type { Session, SessionSearchDirection } from "@zenflow/shared";
import { SunriseIcon } from "@/components/brand/icons";
import { NoResultsMark } from "@/components/brand/state-marks";
import { type Href, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, View } from "react-native";

const PAGE_SIZE = 20;

type Status = "loading" | "ready" | "failed";

const NO_ROWS: SearchListRow[] = [];
const EMPTY_SKELETON_ROWS = [0, 1, 2, 3, 4, 5, 6, 7];

/** Day headers and rows in the agenda's own layout. */
function AgendaSkeleton() {
  return (
    <View testID="session-agenda.skeleton">
      {EMPTY_SKELETON_ROWS.map((i) => (
        <View key={i}>
          {i % 3 === 0 ? <DayHeaderSkeleton /> : null}
          <SessionRowSkeleton wide={i % 2 === 0} />
        </View>
      ))}
    </View>
  );
}

/**
 * Infinite agenda of the user's sessions: day headers, rows in ascending order,
 * pages loading both ways around the moment it opened. `term` filters it (the
 * search screen) or is empty (the List view). A skeleton replaces the rows
 * while a term is typed or loading.
 */
export function SessionAgenda({
  term,
  pending = false,
  onOpenSession,
  testIDPrefix = "session-search",
}: {
  term: string;
  /** A new term is on its way (typed, still debouncing): show the skeleton now. */
  pending?: boolean;
  /** Called before navigating to a session. */
  onOpenSession?: () => void;
  testIDPrefix?: string;
}) {
  const router = useRouter();
  const tabBarOverlay = useTabBarOverlayHeight();
  const tz = useUserStore((s) => s.user?.timezone) || "UTC";

  const [anchor] = useState(() => new Date().toISOString());
  const [sessions, setSessions] = useState<Session[]>([]);
  const [status, setStatus] = useState<Status>("loading");

  const generation = useRef(0);
  const cursorsRef = useRef<Record<SessionSearchDirection, string | null>>({
    forward: null,
    backward: null,
  });
  const pagingRef = useRef<SessionSearchDirection | null>(null);
  const scrolledRef = useRef(false);

  useEffect(() => {
    const gen = ++generation.current;
    pagingRef.current = null;
    cursorsRef.current = { forward: null, backward: null };
    scrolledRef.current = false;
    setStatus("loading");
    const q = term || undefined;
    Promise.all([
      searchSessions({ q, anchor, direction: "backward", limit: PAGE_SIZE }),
      searchSessions({ q, anchor, direction: "forward", limit: PAGE_SIZE }),
    ])
      .then(([before, after]) => {
        if (gen !== generation.current) return;
        cursorsRef.current = {
          backward: before.nextCursor,
          forward: after.nextCursor,
        };
        setSessions(
          mergeSearchPage(
            mergeSearchPage([], before.sessions, "backward"),
            after.sessions,
            "forward",
          ),
        );
        setStatus("ready");
      })
      .catch(() => {
        if (gen === generation.current) setStatus("failed");
      });
  }, [term, anchor]);

  const loadMore = useCallback(
    (direction: SessionSearchDirection) => {
      const cursor = cursorsRef.current[direction];
      if (status !== "ready" || !cursor || pagingRef.current) return;
      const gen = generation.current;
      pagingRef.current = direction;
      searchSessions({ q: term || undefined, cursor, direction, limit: PAGE_SIZE })
        .then((page) => {
          if (gen !== generation.current) return;
          cursorsRef.current = { ...cursorsRef.current, [direction]: page.nextCursor };
          setSessions((prev) => mergeSearchPage(prev, page.sessions, direction));
        })
        .catch(() => {})
        .finally(() => {
          if (gen === generation.current) pagingRef.current = null;
        });
    },
    [status, term],
  );

  const rows = useMemo(
    () => flattenDayGroups(groupSessionsByDay(sessions, tz)),
    [sessions, tz],
  );

  // Every load shows its skeleton at once and holds it briefly, so rows never
  // pop in over old ones; the first rows render after the screen has painted.
  const painted = useAfterPaint();
  const showSkeleton = useDelayedLoading(
    pending || !painted || status === "loading",
  );

  const openSession = (session: Session) => {
    onOpenSession?.();
    navigateOnce(() => router.push(`/task/${encodeURIComponent(session.id)}/edit` as Href));
  };

  const hasQuery = term.length > 0;

  const renderRow = ({ item }: { item: SearchListRow }) => {
    if (item.kind === "day") {
      return (
        <Text
          testID={`${testIDPrefix}.day.${item.date}`}
          accessibilityRole="header"
          className="px-4 pb-1 pt-4 text-[13px] font-semibold text-muted-foreground"
        >
          {dayLabel(item.date)}
        </Text>
      );
    }
    const { session } = item;
    const tone = sessionTone(deriveState(session), session.late);
    const location = session.location?.trim();
    return (
      <Pressable
        testID={`${testIDPrefix}.row.${session.id}`}
        onPress={() => openSession(session)}
        accessibilityRole="button"
        accessibilityLabel={session.title}
        className="mx-4 my-1 rounded-r-xl active:opacity-70"
        style={{ borderLeftWidth: 3, borderLeftColor: SESSION_TONES[tone].base }}
      >
        <View className="gap-0.5 py-2 pl-3">
          <Text testID={`${testIDPrefix}.time.${session.id}`} className="text-[12px] text-muted-foreground">
            {sessionTimeRange(session, tz)}
          </Text>
          <Text numberOfLines={1} className="text-[15px] font-semibold">
            {highlightParts(session.title, term).map((part, i) =>
              part.match ? (
                <Text
                  key={i}
                  testID={`${testIDPrefix}.match`}
                  className="rounded-[4px] bg-brand-orange/40 font-bold"
                >
                  {part.text}
                </Text>
              ) : (
                <Text key={i}>{part.text}</Text>
              ),
            )}
          </Text>
          {location ? (
            <Text numberOfLines={1} className="text-[13px] text-muted-foreground">
              {location}
            </Text>
          ) : null}
        </View>
      </Pressable>
    );
  };

  const empty =
    status === "ready" && !showSkeleton ? (
      <View className="items-center gap-3 px-8 pt-24">
        {hasQuery ? (
          <NoResultsMark size={72} />
        ) : (
          <SunriseIcon size={56} color="#FF8E3E" />
        )}
        <Text className="text-center text-[15px] text-muted-foreground">
          {hasQuery ? t("No sessions match") : t("No sessions yet")}
        </Text>
      </View>
    ) : null;

  return (
    <View className="flex-1">
      {status === "failed" && !showSkeleton ? (
        <Text className="px-4 py-3 text-[13px] text-muted-foreground">
          {t("Couldn't search right now")}
        </Text>
      ) : null}
      {showSkeleton ? <AgendaSkeleton /> : null}
      <FlatList
        style={showSkeleton ? { display: "none" } : undefined}
        data={showSkeleton ? NO_ROWS : rows}
        keyExtractor={(row) => row.key}
        renderItem={renderRow}
        keyboardShouldPersistTaps="handled"
        maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
        onScrollBeginDrag={() => {
          scrolledRef.current = true;
        }}
        onStartReached={() => {
          if (scrolledRef.current) loadMore("backward");
        }}
        onStartReachedThreshold={0.5}
        onEndReached={() => loadMore("forward")}
        onEndReachedThreshold={0.6}
        contentContainerStyle={{ paddingBottom: tabBarOverlay + 24 }}
        ListEmptyComponent={empty ?? undefined}
      />
    </View>
  );
}
