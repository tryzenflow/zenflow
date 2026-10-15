import { listSessionSuggestions } from "@/api/tasks";
import { useLanguage } from "@/hooks/use-language";
import { Search } from "@/components/Icons";
import {
  BottomSheet,
  BottomSheetContent,
  BottomSheetInput,
  BottomSheetScrollView,
  BottomSheetView,
  useBottomSheet,
} from "@/components/ui/bottom-sheet";
import { Text } from "@/components/ui/text";
import { navigateOnce } from "@/lib/nav";
import { t } from "@/lib/i18n";
import type { Session } from "@zenflow/shared";
import { type Href, useRouter } from "expo-router";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { Pressable, View } from "react-native";

export interface SessionSearchSheetHandle {
  open: () => void;
}

/** How long to wait after the last keystroke before searching. */
const SEARCH_DEBOUNCE_MS = 250;

/**
 * Header search: type a title and tap a result to open its edit screen. Backed
 * by the title-autocomplete endpoint (`listSessionSuggestions`), so results are
 * the user's own sessions, newest first, one per title.
 */
export const SessionSearchSheet = forwardRef<SessionSearchSheetHandle>(
  function SessionSearchSheet(_props, ref) {
    useLanguage();
    const sheet = useBottomSheet();
    const router = useRouter();
    const [query, setQuery] = useState("");
    const [results, setResults] = useState<Session[]>([]);
    const [failed, setFailed] = useState(false);

    useImperativeHandle(
      ref,
      () => ({
        open: () => {
          setQuery("");
          setResults([]);
          setFailed(false);
          sheet.open();
        },
      }),
      [sheet],
    );

    useEffect(() => {
      const q = query.trim();
      if (!q) {
        setResults([]);
        setFailed(false);
        return;
      }
      let alive = true;
      const timer = setTimeout(() => {
        listSessionSuggestions(q)
          .then((hits) => {
            if (!alive) return;
            setResults(hits);
            setFailed(false);
          })
          .catch(() => {
            if (alive) setFailed(true);
          });
      }, SEARCH_DEBOUNCE_MS);
      return () => {
        alive = false;
        clearTimeout(timer);
      };
    }, [query]);

    const openSession = (session: Session) => {
      sheet.close();
      navigateOnce(() =>
        router.push(`/task/${encodeURIComponent(session.id)}/edit` as Href),
      );
    };

    return (
      <BottomSheet>
        <BottomSheetContent ref={sheet.ref}>
          <BottomSheetView hadHeader={false} className="gap-2 pt-2">
            <Text className="px-1 text-[19px] font-bold tracking-tight">
              {t("Search sessions")}
            </Text>
            <BottomSheetInput
              value={query}
              onChangeText={setQuery}
              placeholder={t("Search by title")}
              autoCapitalize="none"
              autoCorrect={false}
              rightElement={<Search size={18} className="text-muted-foreground" />}
            />
          </BottomSheetView>
          <BottomSheetScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerClassName="px-4 pb-8"
          >
            {failed ? (
              <Text className="py-4 text-[13px] text-muted-foreground">
                {t("Couldn't search right now")}
              </Text>
            ) : null}
            {query.trim() && !failed && results.length === 0 ? (
              <Text className="py-4 text-[13px] text-muted-foreground">
                {t("No sessions match")}
              </Text>
            ) : null}
            {results.map((session) => (
              <Pressable
                key={session.id}
                onPress={() => openSession(session)}
                accessibilityRole="button"
                className="flex-row items-center gap-3 rounded-xl px-1 py-3 active:opacity-70"
              >
                <View className="min-w-0 flex-1">
                  <Text numberOfLines={1} className="text-[15px] font-semibold">
                    {session.title}
                  </Text>
                </View>
              </Pressable>
            ))}
          </BottomSheetScrollView>
        </BottomSheetContent>
      </BottomSheet>
    );
  },
);
