import { t } from "@/lib/i18n";
import { useLanguage } from "@/hooks/use-language";
import { dateFnsLocale, format, locale } from "@/lib/i18n";
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
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { dismissNotification, rescheduleConflicts } from "@/api/notifications";
import {
  ModalToastScope,
  useModalToast,
} from "@/components/tasks/modal-toast-scope";
import { useDelayedLoading } from "@/hooks/use-delayed-loading";
import { useMotion } from "@/hooks/use-motion";
import { NAV_THEME } from "@/lib/constants";
import { haptic } from "@/lib/haptics";
import { createUndoQueue } from "@/lib/undo-queue";
import { useColorScheme } from "@/lib/useColorScheme";
import Animated from "react-native-reanimated";
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
import { zonedDate } from "@zenflow/core";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  View,
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

const CATEGORY_LABEL: Record<NotificationCategory, string> = {
  get ASSIGNMENT() {
    return t("LMS Assignment");
  },
  get EXAM() {
    return t("Exam");
  },
  get LECTURE() {
    return t("Timetable");
  },
  get REMINDER() {
    return t("Reminder");
  },
};

/** Visual configuration for a notification's eventName, matching mockups/detected-items.html */
/**
 * Icon colours are explicit light/dark pairs (the session-type hues, AA-dark in
 * light mode); conflict and reminder come from the theme mirror. Hex, not
 * classes: NativeWind color interop on lucide icons is unreliable on native.
 */
const ICON_COLOR = {
  ASSIGNMENT: { light: "#0f766e", dark: "#2dd4bf" },
  EXAM: { light: "#e11d48", dark: "#fb7185" },
  LECTURE: { light: "#0369a1", dark: "#38bdf8" },
  CONFLICT: { light: NAV_THEME.light.warning, dark: NAV_THEME.dark.warning },
  REMINDER: {
    light: NAV_THEME.light.primaryText,
    dark: NAV_THEME.dark.primaryText,
  },
} as const;

function notificationVisual(eventName: string): {
  Icon: LucideIcon;
  label: string;
  tint: string;
  iconColor: { light: string; dark: string };
} {
  const category = notificationCategory(eventName);
  if (notificationEventKind(eventName) === "CONFLICT") {
    return {
      Icon: AlertTriangle,
      label: t("{category} conflict", { category: CATEGORY_LABEL[category] }),
      tint: "border-amber-500/40 bg-amber-500/15",
      iconColor: ICON_COLOR.CONFLICT,
    };
  }
  switch (category) {
    case "ASSIGNMENT":
      return {
        Icon: ClipboardList,
        label: CATEGORY_LABEL.ASSIGNMENT,
        tint: "border-teal-500/40 bg-teal-500/15",
        iconColor: ICON_COLOR.ASSIGNMENT,
      };
    case "EXAM":
      return {
        Icon: Notebook,
        label: CATEGORY_LABEL.EXAM,
        tint: "border-rose-500/40 bg-rose-500/15",
        iconColor: ICON_COLOR.EXAM,
      };
    case "LECTURE":
      return {
        Icon: GraduationCap,
        label: CATEGORY_LABEL.LECTURE,
        tint: "border-sky-500/40 bg-sky-500/15",
        iconColor: ICON_COLOR.LECTURE,
      };
    case "REMINDER":
    default:
      return {
        Icon: Bell,
        label: CATEGORY_LABEL.REMINDER,
        tint: "border-primary/40 bg-primary/15",
        iconColor: ICON_COLOR.REMINDER,
      };
  }
}

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
  // A modal screen sits above the root toast stack, so it gets its own.
  return (
    <ModalToastScope>
      <NotificationsBody />
    </ModalToastScope>
  );
}

/** How long a swiped-away notification can be brought back. */
const UNDO_WINDOW_MS = 5000;

function NotificationsBody() {
  useLanguage();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { toast } = useModalToast();
  const motion = useMotion();
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
    const dismissMany = useNotificationsStore((s) => s.dismissMany);
  const clearAll = useNotificationsStore((s) => s.clearAll);
  const markRead = useNotificationsStore((s) => s.markRead);
  const removeLocal = useNotificationsStore((s) => s.removeLocal);
  const restoreLocal = useNotificationsStore((s) => s.restoreLocal);
  const showSkeleton = useDelayedLoading(loading);

  // Swipe-delete hides the row now and deletes for real after the Undo window.
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const undoQueue = useRef(
    createUndoQueue<NotificationDto>({
      delayMs: UNDO_WINDOW_MS,
      commit: (_id, item) => {
        dismissNotification(item.id).catch(() => {
          restoreLocal(item);
          toastRef.current({
            title: t("Couldn't delete notification"),
            description: t("It's back in your inbox. Try again in a moment."),
            variant: "destructive",
          });
        });
      },
    }),
  ).current;
  // Leaving the inbox must not drop a delete the student already saw.
  useEffect(() => () => undoQueue.flush(), [undoQueue]);

  const toggleSelect = useCallback((id: string) => {
    haptic.select();
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
        toast({
          title: failed
            ? t("Rescheduled {ok}, {failed} left", { ok, failed })
            : t("Rescheduled {count} tasks", { count: ok }),
          description: failed
            ? t("The rest still overlap. Move them by hand.")
            : undefined,
          variant: failed ? "warning" : "success",
        });
        void fetchNotifications("refresh");
      } catch {
        toast({
          title: t("Couldn't reschedule tasks"),
          description: t("Try again in a moment."),
          variant: "destructive",
        });
      } finally {
        setReschedulingId(null);
      }
    },
    [fetchNotifications, toast],
  );

  const handleDismiss = useCallback(
    (id: string) => {
      const item = removeLocal(id);
      // Swipe and the Delete button can both fire for one row.
      if (!item) return;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      undoQueue.schedule(id, item);
      toast({
        title: t("Notification deleted"),
        variant: "default",
        duration: UNDO_WINDOW_MS,
        action: {
          label: t("Undo"),
          inline: true,
          onPress: () => {
            const back = undoQueue.undo(id);
            if (back) {
              restoreLocal(back);
              haptic.select();
            }
          },
        },
      });
    },
    [removeLocal, restoreLocal, undoQueue, toast],
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
      toast(t("Deleted {count} notifications", { count }), "default");
    } catch {
      toast({
        title: t("Couldn't delete notifications"),
        description: t("Try again in a moment."),
        variant: "destructive",
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
      toast(t("All notifications cleared"), "default");
    } catch {
      toast({
        title: t("Couldn't clear notifications"),
        description: t("Try again in a moment."),
        variant: "destructive",
      });
    }
  }, [clearAll, toast]);

  const allSelected = items.length > 0 && selectedIds.size === items.length;

  const exitSelecting = useCallback(() => {
    setIsSelecting(false);
    setSelectedIds(new Set());
  }, []);

  const handleSelectAll = useCallback(() => {
    haptic.select();
    if (selectedIds.size === items.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(items.map((x) => x.id)));
    }
  }, [items, selectedIds.size]);

  return (
    <View
      className="flex-1 bg-background"
      style={{
        // iOS presents this as a page sheet already below the status bar; 14 is breathing room.
        paddingTop: Platform.OS === "ios" ? 14 : insets.top,
        paddingBottom: insets.bottom,
      }}
    >
      {/* Header — one row, one primary action per mode */}
      <View className="h-14 flex-row items-center gap-2 border-b border-border/70 bg-background px-3">
        {isSelecting ? (
          <>
            <Pressable
              onPress={exitSelecting}
              accessibilityRole="button"
              accessibilityLabel={t("Cancel selection")}
              className="size-11 items-center justify-center rounded-full active:bg-muted"
            >
              <X size={20} className="text-foreground" />
            </Pressable>
            <Text
              accessibilityRole="header"
              accessibilityLiveRegion="polite"
              className="flex-1 text-[17px] font-semibold text-foreground"
            >
              {selectedIds.size} {t("selected")}
            </Text>
            <Pressable
              onPress={handleSelectAll}
              accessibilityRole="button"
              accessibilityLabel={allSelected ? t("Select none") : t("Select all")}
              className="min-h-11 justify-center rounded-full px-3 active:bg-muted"
            >
              <Text className="text-[13px] font-semibold text-primary-text">
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
              accessibilityRole="button"
              accessibilityLabel={t("Delete selected")}
              accessibilityState={{ disabled: selectedIds.size === 0 }}
              className={cn(
                "size-11 items-center justify-center rounded-full active:bg-destructive/10",
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
              accessibilityRole="button"
              accessibilityLabel={t("Back")}
              className="size-11 items-center justify-center rounded-full active:bg-muted"
            >
              <ChevronLeft size={22} className="text-foreground" />
            </Pressable>
            <View className="flex-1 flex-row items-center gap-2">
              <Text
                accessibilityRole="header"
                className="text-xl font-bold tracking-tight text-foreground"
              >
                {t("Inbox")}
              </Text>
              {unreadCount > 0 && (
                <View
                  accessibilityLabel={t("{count} unread", {
                    count: unreadCount,
                  })}
                  className="h-[20px] min-w-[26px] rounded-full items-center justify-center bg-primary px-2"
                >
                  <Text className="text-sm font-bold leading-none text-primary-foreground">
                    {unreadCount.toLocaleString(locale())}
                  </Text>
                </View>
              )}
            </View>
            {items.length > 0 && (
              <Pressable
                onPress={() => setIsSelecting(true)}
                accessibilityRole="button"
                className="min-h-11 justify-center rounded-full px-3 active:bg-muted"
              >
                <Text className="text-[14px] font-semibold text-primary-text">
                  {t("Select")}
                </Text>
              </Pressable>
            )}
          </>
        )}
      </View>

      {/* Body */}
      {loading ? (
        showSkeleton ? (
          <InboxSkeleton />
        ) : null
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
              <Animated.View
                {...motion.pop()}
                className="mb-4 h-14 w-14 items-center justify-center rounded-full border border-primary/30 bg-primary/10"
              >
                <Check size={24} className="text-primary-text" />
              </Animated.View>
              <Text
                accessibilityRole="header"
                className="text-center text-[16px] font-semibold text-foreground"
              >
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

      {/* Confirm Clear All Modal */}
      {showClearAllConfirm && (
        <Modal
          visible={true}
          transparent
          animationType="fade"
          onRequestClose={() => setShowClearAllConfirm(false)}
        >
          <View
            accessibilityViewIsModal
            className="flex-1 items-center justify-center bg-black/60 px-5"
          >
            <View className="w-full max-w-sm rounded-3xl border border-border bg-card p-6 shadow-2xl">
              <View className="mb-3 h-12 w-12 items-center justify-center rounded-2xl bg-destructive/15">
                <Trash2 size={22} className="text-destructive" />
              </View>
              <Text
                accessibilityRole="header"
                className="text-lg font-bold text-foreground"
              >
                {t("Clear all notifications?")}
              </Text>
              <Text className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {t(
                  "Every notification will be removed for good. This can't be undone.",
                )}
              </Text>

              <View className="mt-6 flex-row gap-3">
                <Button
                  variant="outline"
                  className="h-11 flex-1"
                  onPress={() => setShowClearAllConfirm(false)}
                >
                  <Text>{t("Cancel")}</Text>
                </Button>
                <Button
                  variant="destructive"
                  className="h-11 flex-1"
                  onPress={handleConfirmClearAll}
                >
                  <Text className="font-bold">{t("Clear all")}</Text>
                </Button>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

/** Placeholder rows shown while the first page loads (after a short delay). */
function InboxSkeleton() {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {[0, 1, 2, 3, 4].map((i) => (
        <View
          key={i}
          className="flex-row items-center gap-3.5 border-b border-border/70 px-4 py-3.5"
        >
          <Skeleton className="size-10 rounded-2xl" />
          <View className="flex-1 gap-2">
            <Skeleton className="h-3.5 w-11/12" />
            <Skeleton className="h-3 w-1/3" />
          </View>
        </View>
      ))}
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
  const { isDarkColorScheme } = useColorScheme();
  const palette = isDarkColorScheme ? NAV_THEME.dark : NAV_THEME.light;
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
      accessibilityRole="button"
      accessibilityLabel={t("Delete")}
      className="w-[112px] flex-row items-center justify-center gap-1.5 bg-destructive"
    >
      <Trash2 size={18} className="text-destructive-foreground" />
      <Text className="text-[13px] font-semibold text-destructive-foreground">
        {t("Delete")}
      </Text>
    </Pressable>
  );

  const label = [unread ? t("Unread") : null, n.title, relative, when]
    .filter(Boolean)
    .join(", ");

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
          iOS the Delete action (laid out underneath) showed through at rest. */}
      <View className="bg-background">
        <Pressable
          onPress={onOpen}
          accessibilityRole={isSelecting ? "checkbox" : "button"}
          accessibilityLabel={label}
          accessibilityState={isSelecting ? { checked: isSelected } : undefined}
          accessibilityActions={
            isSelecting ? undefined : [{ name: "delete", label: t("Delete") }]
          }
          onAccessibilityAction={(e) => {
            if (e.nativeEvent.actionName === "delete") onDismiss();
          }}
          className={cn(
            "flex-row items-center gap-3.5 border-b border-border/70 bg-background px-4 py-3.5",
            unread && "bg-primary/10",
            isSelected && "bg-primary/20",
          )}
        >
          {/* Selection checkbox (visible in selection mode): a 24pt mark inside a 44pt target */}
          {isSelecting && (
            <View className="-ml-2 size-11 shrink-0 items-center justify-center">
              <View
                className={cn(
                  "size-6 items-center justify-center rounded-full border-[1.5px]",
                  isSelected
                    ? "border-primary bg-primary"
                    : "border-muted-foreground/60 bg-transparent",
                )}
              >
                {isSelected && (
                  <Check
                    size={15}
                    strokeWidth={3}
                    className="text-primary-foreground"
                  />
                )}
              </View>
            </View>
          )}

          {/* Type icon badge with unread dot */}
          <View className="relative shrink-0">
            <View
              className={cn(
                "h-10 w-10 items-center justify-center rounded-2xl border",
                tint,
              )}
            >
              <Icon
                size={19}
                color={iconColor[isDarkColorScheme ? "dark" : "light"]}
              />
            </View>
            {unread && (
              <View className="absolute -right-0.5 -top-0.5 size-3 rounded-full border-2 border-background bg-primary-text" />
            )}
          </View>

          {/* Content */}
          <View className="min-w-0 flex-1">
            <Text
              numberOfLines={2}
              className={cn(
                "text-[13.5px]",
                unread
                  ? "font-bold text-foreground"
                  : "font-medium text-foreground/85",
              )}
            >
              {n.title}
            </Text>

            {/* Meta line */}
            <View className="mt-1 flex-row items-center gap-1.5">
              <Text
                className={cn(
                  "shrink-0 text-label",
                  unread
                    ? "font-medium text-foreground/80"
                    : "text-muted-foreground",
                )}
              >
                {relative}
              </Text>

              {when && (
                <>
                  <Text className="text-label text-muted-foreground">·</Text>
                  <Text
                    numberOfLines={1}
                    className={cn(
                      "flex-1 text-label",
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
                accessibilityRole="button"
                accessibilityLabel={t("Reschedule them all")}
                accessibilityState={{ busy: rescheduling }}
                className="mt-2 min-h-11 flex-row items-center gap-1.5 self-start rounded-full bg-warning px-4 active:opacity-80"
              >
                {rescheduling ? (
                  <ActivityIndicator size="small" color={palette.background} />
                ) : (
                  <RefreshCw size={13} className="text-background" />
                )}
                <Text className="text-xs font-semibold text-background">
                  {t("Reschedule them all")}
                </Text>
              </Pressable>
            )}
          </View>

          {/* Right indicator: only rows that open something */}
          {!isSelecting && n.sessionId && (
            <View className="shrink-0 pl-1 pr-0.5 items-center justify-center">
              <ChevronRight size={16} className="text-muted-foreground" />
            </View>
          )}
        </Pressable>
      </View>
    </Swipeable>
  );
}
