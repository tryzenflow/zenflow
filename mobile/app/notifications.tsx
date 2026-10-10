import { t } from "@/lib/i18n";
import { useLanguage } from "@/hooks/use-language";
import { dateFnsLocale, format, locale } from "@/lib/i18n";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Trash2,
  X,
} from "@/components/Icons";
import { Glass } from "@/components/ui/glass";
import { Text } from "@/components/ui/text";
import { rescheduleWithToast } from "@/lib/reschedule-toast";
import { useToast } from "@/components/ui/toast";
import {
  useNotificationsStore,
  viewSessionOnCalendar,
} from "@/hooks/use-notifications";
import { useUserStore } from "@/hooks/use-user-store";
import { notificationVisual } from "@/lib/notification-visual";
import { cn } from "@/lib/utils";
import { notificationCategory, type NotificationDto } from "@zenflow/shared";
import { formatDistanceToNow } from "date-fns";
import { zonedDate } from "@zenflow/core";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
// `react-native-gesture-handler/Swipeable` (JS-thread) was removed entirely
// in gesture-handler v3 (bumped for SDK 58) -- only the Reanimated-driven
// version remains, under its own subpath. `renderRightActions`/
// `onSwipeableOpen` here don't use the (progress, translation) worklet args
// it now passes, so the zero-arg callback signatures below still type-check.
import Swipeable, {
  type SwipeableMethods,
} from "react-native-gesture-handler/ReanimatedSwipeable";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** Spelled out "due" or "at" label off eventEndsAt */
function eventTimeLabel(n: NotificationDto, tz: string): string | null {
  if (!n.eventEndsAt) return null;
  try {
    const at = zonedDate(n.eventEndsAt, tz);
    const date = format(at, "MMM d");
    if (notificationCategory(n.eventName) === "ASSIGNMENT")
      return t("due {date}", { date });
    return `${date}, ${format(at, "HH:mm")}`;
  } catch {
    return null;
  }
}

/**
 * The ingestion inbox — LMS / student-portal notifications.
 * Visual target: mockups/detected-items.html.
 * Updates live over SSE, supports selection/delete-all, rich detail modal with
 * Edit and View-on-calendar actions, and swipe-left to dismiss.
 */
export default function NotificationsScreen() {
  useLanguage();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const { toast } = useToast();
  const [reschedulingId, setReschedulingId] = useState<string | null>(null);
  const tz = useUserStore((s) => s.user?.timezone) || "UTC";

  const [isSelecting, setIsSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showClearAllConfirm, setShowClearAllConfirm] = useState(false);

  const items = useNotificationsStore((s) => s.items);
  const unreadCount = useNotificationsStore((s) => s.unreadCount);
  const loading = useNotificationsStore((s) => s.loading);
  const refreshing = useNotificationsStore((s) => s.refreshing);
  const fetchNotifications = useNotificationsStore((s) => s.fetchNotifications);
  const dismiss = useNotificationsStore((s) => s.dismiss);
  const dismissMany = useNotificationsStore((s) => s.dismissMany);
  const clearAll = useNotificationsStore((s) => s.clearAll);
  const markRead = useNotificationsStore((s) => s.markRead);

  const toggleSelect = useCallback((id: string) => {
    void Haptics.selectionAsync();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const openRow = useCallback(
    (n: NotificationDto) => {
      if (isSelecting) {
        toggleSelect(n.id);
        return;
      }
      if (!n.readAt) {
        void markRead(n.id);
      }
      // Opens the session on the calendar; removed-item rows just mark read.
      if (n.sessionId) {
        void viewSessionOnCalendar(n.sessionId, router, toast, n.id);
      }
    },
    [isSelecting, markRead, toggleSelect, router, toast],
  );

  const handleRescheduleAll = useCallback(
    async (n: NotificationDto) => {
      setReschedulingId(n.id);
      await rescheduleWithToast(n.id, toast);
      void fetchNotifications("refresh");
      setReschedulingId(null);
    },
    [fetchNotifications, toast],
  );

  const handleDismiss = useCallback(
    async (id: string) => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      try {
        await dismiss(id);
      } catch {
        toast({
          title: t("Couldn't dismiss notification"),
          description: t("Try again in a moment."),
          variant: "destructive",
          icon: "bell",
        });
      }
    },
    [dismiss, toast],
  );

  const handleDeleteSelected = useCallback(async () => {
    if (selectedIds.size === 0) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const count = selectedIds.size;
    const ids = Array.from(selectedIds);
    setSelectedIds(new Set());
    setIsSelecting(false);
    try {
      await dismissMany(ids);
      toast(t("Deleted {count} notifications", { count }), "default", {
        icon: "trash",
      });
    } catch {
      toast({
        title: t("Couldn't delete notifications"),
        description: t("Try again in a moment."),
        variant: "destructive",
        icon: "trash",
      });
    }
  }, [selectedIds, dismissMany, toast]);

  const handleConfirmClearAll = useCallback(async () => {
    setShowClearAllConfirm(false);
    setIsSelecting(false);
    setSelectedIds(new Set());
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    try {
      await clearAll();
      toast(t("All notifications cleared"), "default", { icon: "bell" });
    } catch {
      toast({
        title: t("Couldn't clear notifications"),
        description: t("Try again in a moment."),
        variant: "destructive",
        icon: "bell",
      });
    }
  }, [clearAll, toast]);

  const allSelected = items.length > 0 && selectedIds.size === items.length;

  const exitSelecting = useCallback(() => {
    setIsSelecting(false);
    setSelectedIds(new Set());
  }, []);

  const handleSelectAll = useCallback(() => {
    void Haptics.selectionAsync();
    if (selectedIds.size === items.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(items.map((x) => x.id)));
    }
  }, [items, selectedIds.size]);

  return (
    <View className="flex-1 justify-end">
      {/* Tap the dimmed area above to close. */}
      <Pressable
        onPress={() => router.back()}
        accessibilityLabel={t("Close")}
        className="absolute inset-0 bg-black/40"
      />
      {/* A bottom sheet at ~68% of the screen (own layout, not a native form
          sheet, so the header can never end up hidden behind the rows). */}
      <View
        className="overflow-hidden rounded-t-[28px] bg-background"
        style={{ height: windowHeight * 0.68, paddingBottom: insets.bottom }}
      >
      <View className="items-center pb-1 pt-2">
        <View className="h-1 w-10 rounded-full bg-muted-foreground/30" />
      </View>
      {/* Header — one row, one primary action per mode */}
      <Glass radius={0} clear intensity={50} style={{ borderWidth: 0, borderBottomWidth: StyleSheet.hairlineWidth }}>
      <View className="h-14 flex-row items-center gap-2 px-3">
        {isSelecting ? (
          <>
            <Pressable
              onPress={exitSelecting}
              accessibilityLabel={t("Cancel selection")}
              hitSlop={8}
              className="size-9 items-center justify-center rounded-full active:bg-muted"
            >
              <X size={20} className="text-foreground" />
            </Pressable>
            <Text className="flex-1 text-[17px] font-semibold text-foreground">
              {selectedIds.size} {t("selected")}
            </Text>
            <Pressable
              onPress={handleSelectAll}
              hitSlop={8}
              className="rounded-full px-3 py-1.5 active:bg-muted"
            >
              <Text className="text-[13px] font-semibold text-primary">
                {allSelected ? t("None") : t("All")}
              </Text>
            </Pressable>
            <Pressable
              disabled={selectedIds.size === 0}
              onPress={
                allSelected
                  ? () => setShowClearAllConfirm(true)
                  : handleDeleteSelected
              }
              accessibilityLabel={t("Delete selected")}
              hitSlop={8}
              className={cn(
                "size-9 items-center justify-center rounded-full active:bg-destructive/10",
                selectedIds.size === 0 && "opacity-40",
              )}
            >
              <Trash2 size={19} className="text-destructive" />
            </Pressable>
          </>
        ) : (
          <>
            <Pressable
              onPress={() => router.back()}
              accessibilityLabel={t("Back")}
              hitSlop={8}
              className="size-9 items-center justify-center rounded-full active:bg-muted"
            >
              <ChevronLeft size={22} className="text-foreground" />
            </Pressable>
            <View className="flex-1 flex-row items-center gap-2">
              <Text className="text-xl font-bold tracking-tight text-foreground">
                {t("Inbox")}
              </Text>
              {unreadCount > 0 && (
                <View className="h-[22px] min-w-[26px] items-center justify-center rounded-full bg-primary px-2">
                  {/* Geist's ascent sits high in a tight line box: nudge it to optical centre. */}
                  <Text
                    style={{ marginTop: 1.5 }}
                    className="text-[13px] font-bold leading-none text-primary-foreground"
                  >
                    {unreadCount.toLocaleString(locale())}
                  </Text>
                </View>
              )}
            </View>
            {items.length > 0 && (
              <Pressable
                onPress={() => setIsSelecting(true)}
                hitSlop={8}
                className="rounded-full px-3 py-1.5 active:bg-muted"
              >
                <Text className="text-[14px] font-semibold text-primary">
                  {t("Select")}
                </Text>
              </Pressable>
            )}
          </>
        )}
      </View>
      </Glass>

      {/* Body */}
      {loading ? (
        <View className="flex-1 items-center justify-center py-20">
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(n) => n.id}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => fetchNotifications("refresh")}
            />
          }
          contentContainerStyle={
            items.length === 0
              ? { flexGrow: 1, justifyContent: "center" }
              : { paddingBottom: 32 }
          }
          ListEmptyComponent={
            <View className="flex-1 items-center justify-center px-8 py-16">
              <View className="mb-4 h-14 w-14 items-center justify-center rounded-full border border-primary/30 bg-primary/10">
                <Check size={24} className="text-primary" />
              </View>
              <Text className="text-center text-[16px] font-semibold text-foreground">
                {t("You're all caught up")}
              </Text>
              <Text className="mt-1.5 text-center text-[13px] leading-snug text-muted-foreground">
                {t("Nothing new from your LMS or student portal.")}
              </Text>
            </View>
          }
          renderItem={({ item: n }) => (
            <NotificationRowItem
              n={n}
              tz={tz}
              isSelecting={isSelecting}
              isSelected={selectedIds.has(n.id)}
              onOpen={() => openRow(n)}
              onDismiss={() => handleDismiss(n.id)}
              rescheduling={reschedulingId === n.id}
              onRescheduleAll={() => handleRescheduleAll(n)}
            />
          )}
        />
      )}

      </View>

      {/* Confirm Clear All Modal */}
      {showClearAllConfirm && (
        <Modal visible={true} transparent animationType="fade">
          <View className="flex-1 items-center justify-center bg-black/60 px-5">
            <View className="w-full max-w-sm rounded-3xl border border-border bg-card p-6 shadow-2xl">
              <View className="mb-3 h-12 w-12 items-center justify-center rounded-2xl bg-destructive/15">
                <Trash2 size={22} className="text-destructive" />
              </View>
              <Text className="text-lg font-bold text-foreground">
                {t("Clear all notifications?")}
              </Text>
              <Text className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {t(
                  "Every notification will be removed for good. This can't be undone.",
                )}
              </Text>

              <View className="mt-6 flex-row gap-3">
                <Pressable
                  onPress={() => setShowClearAllConfirm(false)}
                  className="h-11 flex-1 items-center justify-center rounded-xl border border-border bg-muted/60"
                >
                  <Text className="text-sm font-semibold text-foreground">
                    {t("Cancel")}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={handleConfirmClearAll}
                  className="h-11 flex-1 items-center justify-center rounded-xl bg-destructive active:opacity-90"
                >
                  <Text
                    style={{ color: "#ffffff" }}
                    className="text-sm font-bold text-white"
                  >
                    {t("Clear all")}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

function NotificationRowItem({
  n,
  tz,
  isSelecting,
  isSelected,
  onOpen,
  onDismiss,
  rescheduling,
  onRescheduleAll,
}: {
  n: NotificationDto;
  tz: string;
  isSelecting: boolean;
  isSelected: boolean;
  onOpen: () => void;
  onDismiss: () => void;
  rescheduling: boolean;
  onRescheduleAll: () => void;
}) {
  useLanguage();
  const swipeableRef = useRef<SwipeableMethods>(null);
  const { Icon, tint, iconColor } = notificationVisual(n.eventName);
  const unread = !n.readAt;
  const relative = formatDistanceToNow(new Date(n.sentAt), {
    addSuffix: true,
    locale: dateFnsLocale(),
  });
  const when = eventTimeLabel(n, tz);
  // Reschedule stamps `actionTakenAt` but keeps `conflictSessionIds`.
  const hasConflicts =
    !n.actionTakenAt && (n.conflictSessionIds?.length ?? 0) > 0;

  const renderRightActions = () => (
    <Pressable
      onPress={() => {
        swipeableRef.current?.close();
        onDismiss();
      }}
      className="w-[112px] flex-row items-center justify-center gap-1.5 bg-destructive"
    >
      <Trash2 size={18} color="#ffffff" />
      <Text className="text-[13px] font-semibold text-white">
        {t("Dismiss")}
      </Text>
    </Pressable>
  );

  return (
    <Swipeable
      ref={swipeableRef}
      friction={2}
      overshootRight={false}
      rightThreshold={40}
      enabled={!isSelecting}
      renderRightActions={renderRightActions}
      onSwipeableOpen={() => onDismiss()}
    >
      {/* Opaque base: the row's unread/selected tints are translucent, so on
          iOS the Dismiss action (laid out underneath) showed through at rest. */}
      <View className="bg-background">
        <Pressable
          onPress={onOpen}
          className={cn(
            "flex-row items-center gap-3.5 border-b border-border/70 bg-background px-4 py-3.5",
            unread && "bg-primary/[0.04]",
            isSelected && "bg-primary/[0.09]",
          )}
        >
          {/* Selection Checkbox (visible in selection mode) */}
          {isSelecting && (
            <View
              className={cn(
                "h-6 w-6 shrink-0 items-center justify-center rounded-full border-[1.5px]",
                isSelected
                  ? "border-primary bg-primary"
                  : "border-muted-foreground/50 bg-transparent",
              )}
            >
              {isSelected && (
                <Check size={15} color="#ffffff" strokeWidth={3} />
              )}
            </View>
          )}

          {/* Type icon badge with unread badge */}
          <View className="relative shrink-0">
            <View
              className={cn(
                "h-10 w-10 items-center justify-center rounded-2xl border",
                tint,
              )}
            >
              <Icon size={19} color={iconColor} />
            </View>
            {unread && (
              <View className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-destructive" />
            )}
          </View>

          {/* Content */}
          <View className="min-w-0 flex-1">
            {/* Title line - always aligned! */}
            <Text
              numberOfLines={2}
              className={cn(
                "text-[15px]",
                unread
                  ? "font-semibold text-foreground"
                  : "font-medium text-foreground/85",
              )}
            >
              {n.title}
            </Text>

            {/* Meta line */}
            <View className="mt-1 flex-row items-center gap-1.5">
              <Text
                className={cn(
                  "shrink-0 text-[12.5px]",
                  unread
                    ? "font-medium text-foreground/80"
                    : "text-muted-foreground",
                )}
              >
                {relative}
              </Text>

              {when && (
                <>
                  <Text className="text-[12.5px] text-muted-foreground/60">
                    ·
                  </Text>
                  <Text
                    numberOfLines={1}
                    className={cn(
                      "flex-1 text-[12.5px]",
                      unread
                        ? "font-medium text-foreground/80"
                        : "text-muted-foreground",
                    )}
                  >
                    {when}
                  </Text>
                </>
              )}
            </View>

            {hasConflicts && !isSelecting && (
              <Pressable
                onPress={onRescheduleAll}
                disabled={rescheduling}
                hitSlop={6}
                className="mt-2 flex-row items-center gap-1.5 self-start rounded-full bg-amber-600 px-3 py-1 active:opacity-80"
              >
                {rescheduling ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <RefreshCw size={12} color="#ffffff" />
                )}
                <Text className="text-[12px] font-semibold text-white">
                  {t("Reschedule")}
                </Text>
              </Pressable>
            )}
          </View>

          {/* Right indicator — only rows that open something */}
          {!isSelecting && n.sessionId && (
            <View className="shrink-0 pl-1 pr-0.5 items-center justify-center">
              <ChevronRight size={16} className="text-muted-foreground/40" />
            </View>
          )}
        </Pressable>
      </View>
    </Swipeable>
  );
}
