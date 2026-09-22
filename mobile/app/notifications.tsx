import {
  AlertCircle,
  AlertTriangle,
  Bell,
  Calendar,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  GraduationCap,
  type LucideIcon,
  Notebook,
  RefreshCw,
  Sliders,
  Trash2,
  X,
} from "@/components/Icons";
import { Text } from "@/components/ui/text";
import { rescheduleConflicts } from "@/api/notifications";
import { useToast } from "@/components/ui/toast";
import {
  jumpToSession,
  useNotificationsStore,
  viewSessionOnCalendar,
} from "@/hooks/use-notifications";
import { useUserStore } from "@/hooks/use-user-store";
import { cn } from "@/lib/utils";
import type { NotificationDto, NotificationTopic } from "@zenflow/shared";
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
  ScrollView,
  View,
} from "react-native";
import Swipeable from "react-native-gesture-handler/Swipeable";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** Visual configuration for notification topics matching mockups/detected-items.html */
function topicVisual(topic: NotificationTopic): {
  Icon: LucideIcon;
  label: string;
  tint: string;
  iconColor: string;
} {
  switch (topic) {
    case "ASSIGNMENT":
      return {
        Icon: ClipboardList,
        label: "LMS Assignment",
        tint: "border-teal-500/40 bg-teal-500/15",
        iconColor: "#0f766e",
      };
    case "EXAM":
      return {
        Icon: Notebook,
        label: "Exam",
        tint: "border-rose-500/40 bg-rose-500/15",
        iconColor: "#e11d48",
      };
    case "TIMETABLE":
      return {
        Icon: GraduationCap,
        label: "Timetable",
        tint: "border-sky-500/40 bg-sky-500/15",
        iconColor: "#0369a1",
      };
    case "ASSIGNMENT_CONFLICT":
    case "EXAM_CONFLICT":
    case "TIMETABLE_CONFLICT":
      return {
        Icon: AlertTriangle,
        label:
          topic === "ASSIGNMENT_CONFLICT"
            ? "Assignment conflict"
            : topic === "EXAM_CONFLICT"
              ? "Exam conflict"
              : "Timetable conflict",
        tint: "border-red-500/40 bg-red-500/15",
        iconColor: "#dc2626",
      };
    case "REMINDER":
    default:
      return {
        Icon: Bell,
        label: "Reminder",
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
    if (n.topic === "ASSIGNMENT") return `due ${date}`;
    return `${date}, ${formatInTimeZone(at, tz, "h:mm a")}`;
  } catch {
    return null;
  }
}

/**
 * The ingestion inbox — DLU LMS / student-portal notifications.
 * Visual target: mockups/detected-items.html.
 * Updates live over SSE, supports selection/delete-all, rich detail modal with
 * Edit and View-on-calendar actions, and swipe-left to dismiss.
 */
export default function NotificationsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { toast } = useToast();
  const [rescheduling, setRescheduling] = useState(false);
  const tz = useUserStore((s) => s.user?.timezone) || "UTC";

  const [selectedNotification, setSelectedNotification] =
    useState<NotificationDto | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showClearAllConfirm, setShowClearAllConfirm] = useState(false);

  const items = useNotificationsStore((s) => s.items);
  const unreadCount = useNotificationsStore((s) => s.unreadCount);
  const loading = useNotificationsStore((s) => s.loading);
  const refreshing = useNotificationsStore((s) => s.refreshing);
  const fetchNotifications = useNotificationsStore(
    (s) => s.fetchNotifications,
  );
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
      setSelectedNotification(n);
    },
    [isSelecting, markRead, toggleSelect],
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
      toast(
        `Deleted ${count} notification${count > 1 ? "s" : ""}`,
        "default",
      );
    } catch {
      toast("Couldn't delete selected notifications.", "destructive");
    }
  }, [selectedIds, dismissMany, toast]);

  const handleConfirmClearAll = useCallback(async () => {
    setShowClearAllConfirm(false);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    try {
      await clearAll();
      toast("All notifications cleared", "default");
    } catch {
      toast("Couldn't clear all notifications.", "destructive");
    }
  }, [clearAll, toast]);

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
      {/* Header */}
      {isSelecting ? (
        <View className="relative z-30 flex-row items-center justify-between border-b border-border/70 bg-background px-4 pb-3.5 pt-2">
          <Pressable
            onPress={() => {
              setIsSelecting(false);
              setSelectedIds(new Set());
            }}
            hitSlop={8}
            className="py-1"
          >
            <Text className="text-sm font-medium text-muted-foreground">
              Cancel
            </Text>
          </Pressable>

          <Text className="text-base font-bold text-foreground">
            {selectedIds.size} selected
          </Text>

          <View className="flex-row items-center gap-3">
            <Pressable onPress={handleSelectAll} hitSlop={8} className="py-1">
              <Text className="text-xs font-semibold text-primary">
                {selectedIds.size === items.length
                  ? "Deselect all"
                  : "Select all"}
              </Text>
            </Pressable>

            <Pressable
              disabled={selectedIds.size === 0}
              onPress={handleDeleteSelected}
              hitSlop={8}
              className={cn("py-1", selectedIds.size === 0 && "opacity-40")}
            >
              <Text className="text-sm font-bold text-destructive">
                Delete ({selectedIds.size})
              </Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View className="relative z-30 flex-row items-center justify-between border-b border-border/70 bg-background px-3 pb-3.5 pt-1.5">
          <View className="flex-row items-center gap-2.5">
            <Pressable
              onPress={() => router.back()}
              accessibilityLabel="Back"
              hitSlop={8}
              className="h-9 w-9 items-center justify-center rounded-xl bg-muted/50 border border-border/40 active:bg-muted"
            >
              <ChevronLeft size={20} className="text-foreground" />
            </Pressable>
            <Text className="text-xl font-bold tracking-tight text-foreground">
              Inbox
            </Text>
            {unreadCount > 0 && (
              <View className="flex-row items-center gap-1 rounded-full border border-red-500/40 bg-red-500/10 px-2.5 py-1">
                <AlertCircle size={11} color="#ef4444" />
                <Text className="text-[11px] font-bold leading-none text-red-500">
                  {unreadCount} unread
                </Text>
              </View>
            )}
          </View>

          {items.length > 0 && (
            <View className="flex-row items-center gap-2">
              <Pressable
                onPress={() => setIsSelecting(true)}
                hitSlop={6}
                className="rounded-xl border border-border/80 bg-muted/60 px-3 py-1.5 active:bg-muted"
              >
                <Text className="text-xs font-semibold text-foreground">
                  Select
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setShowClearAllConfirm(true)}
                hitSlop={6}
                className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-1.5 active:bg-destructive/20"
              >
                <Text className="text-xs font-semibold text-destructive">
                  Clear all
                </Text>
              </Pressable>
            </View>
          )}
        </View>
      )}

      {/* Dismiss hint pinned to top */}
      <View className="shrink-0 border-b border-border/40 bg-muted/20 px-4 py-2">
        <Text className="text-[11.5px] font-medium text-muted-foreground">
          {isSelecting
            ? "Tap items to select or deselect"
            : "Swipe left to dismiss · Tap to view details"}
        </Text>
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
                No new notifications from your LMS or student portal. Zenflow will
                automatically notify you when assignments or schedule changes are detected.
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
            />
          )}
        />
      )}

      {/* Detail Modal with Edit and View on Calendar */}
      {selectedNotification && (
        <NotificationDetailModal
          n={selectedNotification}
          tz={tz}
          onClose={() => setSelectedNotification(null)}
          onDismiss={() => {
            const id = selectedNotification.id;
            setSelectedNotification(null);
            void handleDismiss(id);
          }}
          onEdit={async () => {
            const sid = selectedNotification.sessionId;
            const nid = selectedNotification.id;
            setSelectedNotification(null);
            if (sid) {
              await jumpToSession(sid, router, toast, nid, true);
            }
          }}
          rescheduling={rescheduling}
          onRescheduleAll={async () => {
            const nid = selectedNotification.id;
            setRescheduling(true);
            try {
              const res = await rescheduleConflicts(nid);
              const ok = res.rescheduled.length;
              const failed = res.failedSessionIds.length;
              toast(
                failed
                  ? `Rescheduled ${ok}; ${failed} still conflict`
                  : `Rescheduled ${ok} task${ok === 1 ? "" : "s"}`,
                failed ? "warning" : "success",
              );
              setSelectedNotification(null);
              void fetchNotifications("refresh");
            } catch {
              toast("Couldn't reschedule the conflicting tasks.", "destructive");
            } finally {
              setRescheduling(false);
            }
          }}
          onViewOnCalendar={async () => {
            const sid = selectedNotification.sessionId;
            const nid = selectedNotification.id;
            setSelectedNotification(null);
            if (sid) {
              await viewSessionOnCalendar(sid, router, toast, nid);
            }
          }}
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
                All notifications in your inbox will be permanently removed. This action cannot be undone.
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
                  <Text style={{ color: "#ffffff" }} className="text-sm font-bold text-white">
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
}: {
  n: NotificationDto;
  tz: string;
  isSelecting: boolean;
  isSelected: boolean;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const swipeableRef = useRef<Swipeable>(null);
  const { Icon, tint, iconColor } = topicVisual(n.topic);
  const unread = !n.readAt;
  const relative = formatDistanceToNow(new Date(n.sentAt), { addSuffix: true });
  const when = eventTimeLabel(n, tz);

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
              "h-5 w-5 shrink-0 items-center justify-center rounded-lg border",
              isSelected
                ? "border-primary bg-primary"
                : "border-muted-foreground/50 bg-transparent",
            )}
          >
            {isSelected && <Check size={13} color="#ffffff" strokeWidth={3} />}
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
            numberOfLines={1}
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
        </View>

        {/* Right indicator */}
        {!isSelecting && (
          <View className="shrink-0 pl-1 pr-0.5 items-center justify-center">
            <ChevronRight size={16} className="text-muted-foreground/40" />
          </View>
        )}
      </Pressable>
    </Swipeable>
  );
}

/** Detail Dialog for a tapped notification with Edit and View on Calendar */
function NotificationDetailModal({
  n,
  tz: _tz,
  onClose,
  onDismiss,
  onEdit,
  onViewOnCalendar,
  onRescheduleAll,
  rescheduling,
}: {
  n: NotificationDto;
  tz?: string;
  onClose: () => void;
  onDismiss: () => void;
  onEdit: () => void;
  onViewOnCalendar: () => void;
  onRescheduleAll: () => void;
  rescheduling: boolean;
}) {
  const { Icon, label: topicLabel, tint, iconColor } = topicVisual(n.topic);

  return (
    <Modal visible={true} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 items-center justify-center bg-black/70 px-5">
        <View className="w-full max-w-sm rounded-[28px] border border-border/80 bg-card p-5 shadow-2xl">
          {/* Header row */}
          <View className="flex-row items-center justify-between pb-2">
            <View className="flex-row items-center gap-3">
              <View
                className={cn(
                  "h-11 w-11 items-center justify-center rounded-2xl border",
                  tint,
                )}
              >
                <Icon size={22} color={iconColor} />
              </View>
              <View>
                <Text className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  {topicLabel}
                </Text>
              </View>
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              className="h-8 w-8 items-center justify-center rounded-full bg-muted/80 active:bg-muted border border-border/40"
            >
              <X size={16} className="text-muted-foreground" />
            </Pressable>
          </View>

          {/* Title and content */}
          <ScrollView className="my-3 max-h-56" showsVerticalScrollIndicator={false}>
            <Text className="text-[17px] font-bold leading-snug tracking-tight text-foreground">
              {n.title}
            </Text>
            {n.content ? (
              <Text className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">
                {n.content}
              </Text>
            ) : null}
          </ScrollView>

          {/* Action buttons: View on Calendar & Edit Session */}
          <View className="gap-2.5 pt-3 border-t border-border/50">
            {n.conflictSessionIds?.length > 0 ? (
              <Pressable
                onPress={onRescheduleAll}
                disabled={rescheduling}
                className="h-12 w-full flex-row items-center justify-center gap-2.5 rounded-2xl bg-red-600 active:opacity-90 disabled:opacity-60"
              >
                {rescheduling ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <RefreshCw size={18} color="#ffffff" />
                )}
                <Text
                  style={{ color: "#ffffff" }}
                  className="text-[14.5px] font-bold text-white tracking-wide"
                >
                  Reschedule them all
                </Text>
              </Pressable>
            ) : null}
            {n.sessionId ? (
              <View className="gap-2.5">
                {/* Button 1: View on calendar */}
                <Pressable
                  onPress={onViewOnCalendar}
                  className="h-12 w-full flex-row items-center justify-center gap-2.5 rounded-2xl bg-primary shadow-sm active:opacity-90"
                >
                  <Calendar size={18} color="#ffffff" />
                  <Text
                    style={{ color: "#ffffff" }}
                    className="text-[14.5px] font-bold text-white tracking-wide"
                  >
                    View on calendar
                  </Text>
                </Pressable>

                {/* Button 2: Edit session */}
                <Pressable
                  onPress={onEdit}
                  className="h-11 w-full flex-row items-center justify-center gap-2 rounded-2xl border border-border/80 bg-muted/60 active:bg-muted"
                >
                  <Sliders size={16} className="text-foreground" />
                  <Text className="text-[14px] font-semibold text-foreground">
                    Edit session
                  </Text>
                </Pressable>
              </View>
            ) : (
              <View className="rounded-xl border border-border/60 bg-muted/40 p-3">
                <Text className="text-center text-xs leading-relaxed text-muted-foreground">
                  This notification is not linked to an active calendar session.
                </Text>
              </View>
            )}

            {/* Button 3: Dismiss notification */}
            <Pressable
              onPress={onDismiss}
              className="mt-0.5 h-10 w-full flex-row items-center justify-center gap-2 rounded-2xl border border-destructive/20 bg-destructive/10 active:bg-destructive/20"
            >
              <Trash2 size={15} color="#ef4444" />
              <Text className="text-[13px] font-semibold text-destructive">
                Dismiss notification
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
