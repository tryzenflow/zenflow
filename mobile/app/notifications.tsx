import {
  AlertTriangle,
  Bell,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  GraduationCap,
  type LucideIcon,
  Notebook,
  RefreshCw,
  Trash2,
  X,
} from "@/components/Icons";
import { Text } from "@/components/ui/text";
import { rescheduleConflicts } from "@/api/notifications";
import { useToast } from "@/components/ui/toast";
import {
  useNotificationsStore,
  viewSessionOnCalendar,
} from "@/hooks/use-notifications";
import { useUserStore } from "@/hooks/use-user-store";
import { cn } from "@/lib/utils";
import {
  notificationCategory,
  notificationEventKind,
  type NotificationCategory,
  type NotificationDto,
} from "@zenflow/shared";
import { formatDistanceToNow } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  View,
} from "react-native";
import Swipeable from "react-native-gesture-handler/Swipeable";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const CATEGORY_LABEL: Record<NotificationCategory, string> = {
  ASSIGNMENT: "LMS Assignment",
  EXAM: "Exam",
  LECTURE: "Timetable",
  REMINDER: "Reminder",
};

/** Visual configuration for a notification's eventName, matching mockups/detected-items.html */
function notificationVisual(eventName: string): {
  Icon: LucideIcon;
  label: string;
  tint: string;
  iconColor: string;
} {
  const category = notificationCategory(eventName);
  if (notificationEventKind(eventName) === "CONFLICT") {
    return {
      Icon: AlertTriangle,
      label: `${CATEGORY_LABEL[category]} conflict`,
      tint: "border-red-500/40 bg-red-500/15",
      iconColor: "#dc2626",
    };
  }
  switch (category) {
    case "ASSIGNMENT":
      return {
        Icon: ClipboardList,
        label: CATEGORY_LABEL.ASSIGNMENT,
        tint: "border-teal-500/40 bg-teal-500/15",
        iconColor: "#0f766e",
      };
    case "EXAM":
      return {
        Icon: Notebook,
        label: CATEGORY_LABEL.EXAM,
        tint: "border-rose-500/40 bg-rose-500/15",
        iconColor: "#e11d48",
      };
    case "LECTURE":
      return {
        Icon: GraduationCap,
        label: CATEGORY_LABEL.LECTURE,
        tint: "border-sky-500/40 bg-sky-500/15",
        iconColor: "#0369a1",
      };
    case "REMINDER":
    default:
      return {
        Icon: Bell,
        label: CATEGORY_LABEL.REMINDER,
        tint: "border-primary/40 bg-primary/15",
        iconColor: "#f97316",
      };
  }
}

/** Spelled out "due" or "at" label off eventEndsAt */
function eventTimeLabel(n: NotificationDto, tz: string): string | null {
  if (!n.eventEndsAt) return null;
  try {
    const at = new Date(n.eventEndsAt);
    const date = formatInTimeZone(at, tz, "MMM d");
    if (notificationCategory(n.eventName) === "ASSIGNMENT")
      return `due ${date}`;
    return `${date}, ${formatInTimeZone(at, tz, "h:mm a")}`;
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
  const router = useRouter();
  const insets = useSafeAreaInsets();
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
      try {
        const res = await rescheduleConflicts(n.id);
        const ok = res.rescheduled.length;
        const failed = res.failedSessionIds.length;
        toast(
          failed
            ? `Rescheduled ${ok}; ${failed} still conflict`
            : `Rescheduled ${ok} task${ok === 1 ? "" : "s"}`,
          failed ? "warning" : "success",
        );
        void fetchNotifications("refresh");
      } catch {
        toast("Couldn't reschedule the conflicting tasks.", "destructive");
      } finally {
        setReschedulingId(null);
      }
    },
    [fetchNotifications, toast],
  );

  const handleDismiss = useCallback(
    async (id: string) => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      try {
        await dismiss(id);
      } catch {
        toast("Couldn't dismiss that notification.", "destructive");
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
      toast(`Deleted ${count} notification${count > 1 ? "s" : ""}`, "default");
    } catch {
      toast("Couldn't delete selected notifications.", "destructive");
    }
  }, [selectedIds, dismissMany, toast]);

  const handleConfirmClearAll = useCallback(async () => {
    setShowClearAllConfirm(false);
    setIsSelecting(false);
    setSelectedIds(new Set());
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    try {
      await clearAll();
      toast("All notifications cleared", "default");
    } catch {
      toast("Couldn't clear all notifications.", "destructive");
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
    <View
      className="flex-1 bg-background"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      {/* Header — one row, one primary action per mode */}
      <View className="h-14 flex-row items-center gap-2 border-b border-border/70 bg-background px-3">
        {isSelecting ? (
          <>
            <Pressable
              onPress={exitSelecting}
              accessibilityLabel="Cancel selection"
              hitSlop={8}
              className="size-9 items-center justify-center rounded-full active:bg-muted"
            >
              <X size={20} className="text-foreground" />
            </Pressable>
            <Text className="flex-1 text-[17px] font-semibold text-foreground">
              {selectedIds.size} selected
            </Text>
            <Pressable
              onPress={handleSelectAll}
              hitSlop={8}
              className="rounded-full px-3 py-1.5 active:bg-muted"
            >
              <Text className="text-[13px] font-semibold text-primary">
                {allSelected ? "None" : "All"}
              </Text>
            </Pressable>
            <Pressable
              disabled={selectedIds.size === 0}
              onPress={
                allSelected
                  ? () => setShowClearAllConfirm(true)
                  : handleDeleteSelected
              }
              accessibilityLabel="Delete selected"
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
              accessibilityLabel="Back"
              hitSlop={8}
              className="size-9 items-center justify-center rounded-full active:bg-muted"
            >
              <ChevronLeft size={22} className="text-foreground" />
            </Pressable>
            <View className="flex-1 flex-row items-center gap-2">
              <Text className="text-xl font-bold tracking-tight text-foreground">
                Inbox
              </Text>
              {unreadCount > 0 && (
                <View className="h-[20px] min-w-[26px] rounded-full items-center justify-center bg-primary px-2">
                  <Text className="text-sm font-bold leading-none text-primary-foreground">
                    {unreadCount.toLocaleString("en-US")}
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
                  Select
                </Text>
              </Pressable>
            )}
          </>
        )}
      </View>

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
                You're all caught up
              </Text>
              <Text className="mt-1.5 text-center text-[13px] leading-snug text-muted-foreground">
                No new notifications from your LMS or student portal.
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

      {/* Confirm Clear All Modal */}
      {showClearAllConfirm && (
        <Modal visible={true} transparent animationType="fade">
          <View className="flex-1 items-center justify-center bg-black/60 px-5">
            <View className="w-full max-w-sm rounded-3xl border border-border bg-card p-6 shadow-2xl">
              <View className="mb-3 h-12 w-12 items-center justify-center rounded-2xl bg-destructive/15">
                <Trash2 size={22} className="text-destructive" />
              </View>
              <Text className="text-lg font-bold text-foreground">
                Clear all notifications?
              </Text>
              <Text className="mt-2 text-sm leading-relaxed text-muted-foreground">
                All notifications in your inbox will be permanently removed.
                This action cannot be undone.
              </Text>

              <View className="mt-6 flex-row gap-3">
                <Pressable
                  onPress={() => setShowClearAllConfirm(false)}
                  className="h-11 flex-1 items-center justify-center rounded-xl border border-border bg-muted/60"
                >
                  <Text className="text-sm font-semibold text-foreground">
                    Cancel
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
                    Clear all
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
  const swipeableRef = useRef<Swipeable>(null);
  const { Icon, tint, iconColor } = notificationVisual(n.eventName);
  const unread = !n.readAt;
  const relative = formatDistanceToNow(new Date(n.sentAt), { addSuffix: true });
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
      <Text className="text-[13px] font-semibold text-white">Dismiss</Text>
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
            {isSelected && <Check size={15} color="#ffffff" strokeWidth={3} />}
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
              "text-[13.5px]",
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
                "shrink-0 text-[11px]",
                unread
                  ? "font-medium text-foreground/80"
                  : "text-muted-foreground",
              )}
            >
              {relative}
            </Text>

            {when && (
              <>
                <Text className="text-[11px] text-muted-foreground/60">·</Text>
                <Text
                  numberOfLines={1}
                  className={cn(
                    "flex-1 text-[11px]",
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
              className="mt-2 flex-row items-center gap-1.5 self-start rounded-full bg-destructive px-3 py-1 active:opacity-80"
            >
              {rescheduling ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <RefreshCw size={12} color="#ffffff" />
              )}
              <Text className="text-[12px] font-semibold text-white">
                Reschedule them all
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
    </Swipeable>
  );
}
