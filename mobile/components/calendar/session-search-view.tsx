import { searchSessions } from "@/api/tasks";
import { GlassButton } from "@/components/ui/glass-button";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { useLanguage } from "@/hooks/use-language";
import { useUserStore } from "@/hooks/use-user-store";
import { ChevronLeft, Search } from "@/components/Icons";
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
import { deriveState, SESSION_TONES, sessionTone } from "@zenflow/core";
import type { Session, SessionSearchDirection } from "@zenflow/shared";
import { type Href, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BackHandler,
  FlatList,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** How long to wait after the last keystroke before searching. */
const SEARCH_DEBOUNCE_MS = 250;
const PAGE_SIZE = 20;

type Status = "loading" | "ready" | "failed";

/**
 * Full-screen search over the user's sessions. Opens with the field focused and
 * lists matches under day headers, in ascending order. Pages load in both
 * directions around the anchor (the moment it opened). Mount it to open, and
 * unmount it through `onClose` to go back.
 */
export function SessionSearchView({ onClose }: { onClose: () => void }) {
  useLanguage();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tz = useUserStore((s) => s.user?.timezone) || "UTC";

  const [anchor] = useState(() => new Date().toISOString());
  const [query, setQuery] = useState("");
  const [term, setTerm] = useState("");
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
    const timer = setTimeout(() => setTerm(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const gen = ++generation.current;
    pagingRef.current = null;
    cursorsRef.current = { forward: null, backward: null };
    setSessions([]);
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

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [onClose]);

  const rows = useMemo(
    () => flattenDayGroups(groupSessionsByDay(sessions, tz)),
    [sessions, tz],
  );

  const openSession = (session: Session) => {
    onClose();
    navigateOnce(() => router.push(`/task/${encodeURIComponent(session.id)}/edit` as Href));
  };

  const hasQuery = term.length > 0;

  const renderRow = ({ item }: { item: SearchListRow }) => {
    if (item.kind === "day") {
      return (
        <Text
          testID={`session-search.day.${item.date}`}
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
        testID={`session-search.row.${session.id}`}
        onPress={() => openSession(session)}
        accessibilityRole="button"
        accessibilityLabel={session.title}
        className="mx-4 my-1 rounded-r-xl active:opacity-70"
        style={{ borderLeftWidth: 3, borderLeftColor: SESSION_TONES[tone].base }}
      >
        <View className="gap-0.5 py-2 pl-3">
          <Text testID={`session-search.time.${session.id}`} className="text-[12px] text-muted-foreground">
            {sessionTimeRange(session, tz)}
          </Text>
          <Text numberOfLines={1} className="text-[15px] font-semibold">
            {highlightParts(session.title, query.trim()).map((part, i) =>
              part.match ? (
                <Text
                  key={i}
                  testID="session-search.match"
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

  return (
    <View
      testID="session-search.view"
      className="bg-background"
      style={[StyleSheet.absoluteFill, { paddingTop: insets.top }]}
    >
      <View className="flex-row items-center gap-2 px-4 pb-2 pt-2">
        <GlassButton
          icon={ChevronLeft}
          accessibilityLabel={t("Back")}
          onPress={onClose}
          haptic={false}
          testID="session-search.back"
        />
        <Input
          className="flex-1"
          value={query}
          onChangeText={setQuery}
          placeholder={t("Search title, note or location")}
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          testID="session-search.input"
          rightElement={<Search size={18} className="text-muted-foreground" />}
        />
      </View>
      {status === "failed" ? (
        <Text className="px-4 py-3 text-[13px] text-muted-foreground">
          {t("Couldn't search right now")}
        </Text>
      ) : null}
      <FlatList
        data={status === "ready" ? rows : []}
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
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        ListEmptyComponent={() =>
          status === "ready" ? (
            <Text className="px-4 py-4 text-[13px] text-muted-foreground">
              {hasQuery ? t("No sessions match") : t("No sessions yet")}
            </Text>
          ) : null
        }
      />
    </View>
  );
}
