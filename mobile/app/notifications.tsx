import {
  listNotifications,
  markNotificationActionTaken,
  markNotificationRead,
} from "@/api/notifications";
import { getSessionDetails } from "@/api/tasks";
import {
  Bell,
  CalendarClock,
  ClipboardList,
  type LucideIcon,
  Notebook,
  X,
} from "@/components/Icons";
import { Text } from "@/components/ui/text";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { NotificationDto, NotificationTopic } from "@zenflow/shared";
import { formatDistanceToNow } from "date-fns";
import { type Href, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const TOPIC_ICON: Record<NotificationTopic, LucideIcon> = {
  ASSIGNMENT: ClipboardList,
  EXAM: Notebook,
  TIMETABLE: CalendarClock,
  REMINDER: Bell,
};

/** The ingestion inbox — DLU LMS / student-portal notifications, newest first
 * (unread first). Opened from the bell on the Week / Month headers. */
export default function NotificationsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { toast } = useToast();
  const [items, setItems] = useState<NotificationDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (mode: "initial" | "refresh" = "initial") => {
      if (mode === "refresh") setRefreshing(true);
      try {
        const res = await listNotifications({ limit: 50 });
        setItems(res.notifications);
      } catch {
        toast("Couldn't load your notifications", "destructive");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    load();
  }, [load]);

  const openRow = async (n: NotificationDto) => {
    if (!n.readAt) {
      setItems((prev) =>
        prev.map((x) =>
          x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x,
        ),
      );
      markNotificationRead(n.id).catch(() => {});
    }
    if (!n.sessionId) return;
    try {
      // The ingested session may have been deleted since — surface an error
      // rather than opening an empty editor.
      await getSessionDetails(n.sessionId);
    } catch {
      toast("That item isn't on your calendar anymore.", "destructive");
      return;
    }
    if (!n.actionTakenAt) markNotificationActionTaken(n.id).catch(() => {});
    router.replace(`/task/${encodeURIComponent(n.sessionId)}/edit` as Href);
  };

  return (
    <View
      className="flex-1 bg-background"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <View className="flex-row items-center justify-between border-b border-border px-5 pb-3.5 pt-2">
        <Text className="text-[19px] font-bold tracking-tight">
          Notifications
        </Text>
        <Pressable
          onPress={() => router.back()}
          accessibilityLabel="Close"
          className="h-8 w-8 items-center justify-center rounded-full bg-muted"
        >
          <X size={16} className="text-muted-foreground" />
        </Pressable>
      </View>

      {loading ? (
        <View className="items-center py-20">
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(n) => n.id}
          contentContainerStyle={{ paddingBottom: 32 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load("refresh")}
            />
          }
          ListEmptyComponent={
            <View className="items-center px-8 py-20">
              <Bell size={28} className="text-muted-foreground" />
              <Text className="mt-3 text-center text-[13px] text-muted-foreground">
                Nothing here yet. Connect an LMS or student portal in Settings to
                pull assignments, exams and classes onto your calendar.
              </Text>
            </View>
          }
          renderItem={({ item: n }) => {
            const Icon = TOPIC_ICON[n.topic];
            return (
              <Pressable
                onPress={() => openRow(n)}
                className={cn(
                  "flex-row items-start gap-3 border-b border-border px-5 py-3.5",
                  !n.readAt && "bg-primary/[0.04]",
                )}
              >
                <View className="mt-0.5 h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <Icon size={16} className="text-muted-foreground" />
                </View>
                <View className="min-w-0 flex-1">
                  <View className="flex-row items-center gap-1.5">
                    {!n.readAt && (
                      <View className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                    )}
                    <Text className="flex-1 text-[14px] font-semibold">
                      {n.title}
                    </Text>
                  </View>
                  <Text className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">
                    {n.content}
                  </Text>
                  <Text className="mt-1 text-[11px] text-muted-foreground">
                    {formatDistanceToNow(new Date(n.sentAt), {
                      addSuffix: true,
                    })}
                    {n.sessionId ? " · View session" : ""}
                  </Text>
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}
