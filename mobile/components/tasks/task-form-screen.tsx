import { useLanguage } from "@/hooks/use-language";
import { t } from "@/lib/i18n";
import { Eye, Pencil, X } from "@/components/Icons";
import { SunriseBackdrop } from "@/components/brand/sunrise-backdrop";
import { useColorScheme } from "@/lib/useColorScheme";
import { Glass } from "@/components/ui/glass";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { type ReactNode, createContext, useContext, useRef } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  type ScrollViewInstance,
  StyleSheet,
  View,
  type ViewInstance,
  findNodeHandle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * The form screen's single scroll owner, exposed so a field far down the
 * form (currently just `DescriptionFieldEditor`'s WebView editor — see
 * `form/description-field.tsx`) can scroll itself into view above the
 * keyboard on focus. This is needed because RN's `ScrollView` only
 * auto-scrolls to the currently-focused element for a real native
 * `TextInput` (`TextInputState`-driven) — a `react-native-webview` has no
 * such integration, so a WebView-hosted input focusing deep inside the
 * WebView never triggers the scroll RN gives every other field for free
 * (Android's `softwareKeyboardLayoutMode: "resize"`, `app.config.ts`, only
 * resizes the *window*; it doesn't scroll this ScrollView's content to
 * reveal whatever's now supposed to be visible in the shrunk viewport).
 */
/** Scroll padding that keeps the last field clear of the glass footer (52 button + padding). */
const FOOTER_CLEARANCE = 96;

const SessionFormScrollContext =
  createContext<React.RefObject<ScrollViewInstance | null> | null>(null);

/**
 * `scrollResponderScrollNativeHandleToKeyboard` is a legacy-bridge
 * `ScrollResponder` mixin method tied to the old `findNodeHandle`/numeric
 * view-tag system -- it's gone from `ScrollViewImperativeMethods`'s type
 * entirely as of RN 0.88 (New Architecture host components don't use numeric
 * node handles the same way; see `HostInstance`'s doc comment). It may or may
 * not still exist at runtime depending on architecture/platform -- this file
 * already only calls it after checking `typeof ... === "function"`, so the
 * narrow cast below only restores that possibility to the type; it doesn't
 * change runtime behavior. Flagged: not confirmed working on-device under
 * the New Architecture, only that it no-ops safely if absent.
 */
interface LegacyScrollResponder {
  scrollResponderScrollNativeHandleToKeyboard?: (
    handle: number,
    additionalOffset?: number,
    preventNegativeScroll?: boolean,
  ) => void;
}

/**
 * Scrolls a given node (by ref) into view above the keyboard, the same way
 * RN's `ScrollView` already does automatically for a focused native
 * `TextInput` — for callers (like the WebView note editor) that don't get
 * that behavior for free. No-ops outside `SessionFormScreen` or if the
 * scroll-responder API isn't available on this RN version/architecture.
 */
export function useScrollIntoViewOnFocus() {
  const scrollViewRef = useContext(SessionFormScrollContext);
  return (nodeRef: React.RefObject<ViewInstance | null>) => {
    const scrollView = scrollViewRef?.current;
    const node = nodeRef.current;
    if (!scrollView || !node) return;
    const responder = scrollView.getScrollResponder?.() as
      | LegacyScrollResponder
      | undefined;
    const handle = findNodeHandle(node);
    if (
      !responder ||
      typeof responder.scrollResponderScrollNativeHandleToKeyboard !==
        "function" ||
      !handle
    ) {
      return;
    }
    responder.scrollResponderScrollNativeHandleToKeyboard(handle, 80, true);
  };
}

/**
 * View | Edit segmented control for the header. Two labelled-by-icon segments
 * (eye, pencil) with the active one filled, so it cannot be mistaken for the
 * delete or close buttons beside it.
 */
function ModeToggle({
  value,
  onValueChange,
}: {
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  const Segment = ({
    editing,
    Icon,
    label,
  }: {
    editing: boolean;
    Icon: typeof Eye;
    label: string;
  }) => {
    const active = value === editing;
    return (
      <Pressable
        onPress={() => {
          if (active) return;
          Haptics.selectionAsync().catch(() => {});
          onValueChange(editing);
        }}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        accessibilityLabel={label}
        hitSlop={4}
        className={cn(
          "h-9 w-11 items-center justify-center rounded-full",
          active && "bg-primary",
        )}
      >
        <Icon
          size={20}
          className={active ? "text-primary-foreground" : "text-muted-foreground"}
        />
      </Pressable>
    );
  };
  return (
    <Glass radius={22} intensity={30} style={{ padding: 3, flexDirection: "row" }}>
      <Segment editing={false} Icon={Eye} label={t("View")} />
      <Segment editing Icon={Pencil} label={t("Edit")} />
    </Glass>
  );
}

/**
 * Shared chrome for the task create/edit screens (`app/task/new.tsx`,
 * `app/task/[id]/edit.tsx`) — was previously each sheet's own hand-rolled
 * header + `BottomSheetScrollView` + `BottomSheetFooter` before the task
 * form moved off `@gorhom/bottom-sheet` onto its own full screen (see
 * mobile/README.md for why).
 *
 * Header: title/subtitle on the left (unchanged copy from the old sheets),
 * an optional `headerRight` slot (the Edit screen's "Delete" button), and a
 * close "X". The old sheets relied on the native swipe-down/backdrop-tap
 * gesture to dismiss, which a plain screen doesn't get for free — this adds
 * an explicit affordance (the hardware back button and edge-swipe-back
 * gesture still work too, since this is a normal pushed Stack screen under
 * `presentation: "modal"`).
 */
export function SessionFormScreen({
  title,
  subtitle,
  headerRight,
  editSwitch,
  footer,
  children,
}: {
  title: string;
  subtitle?: string;
  headerRight?: ReactNode;
  /** Edit-mode toggle rendered beside the close button (view/edit screens). */
  editSwitch?: { value: boolean; onValueChange: (value: boolean) => void };
  /** Omit to render no pinned footer (e.g. read-only view mode). */
  footer?: ReactNode;
  children: ReactNode;
}) {
  useLanguage();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const scrollViewRef = useRef<ScrollViewInstance | null>(null);
  const { isDarkColorScheme } = useColorScheme();

  return (
    <View
      className="flex-1 bg-background"
      style={{
        // iOS modal page sheet already sits below the status bar.
        paddingTop: Platform.OS === "ios" ? 14 : insets.top,
        // No bottom padding: the glass footer runs to the screen's bottom edge
        // and the scroll content pads itself clear of it.
      }}
    >
      {/* A faint wash of the logo gradient: the glass fields need something to frost. */}
      <SunriseBackdrop dark={isDarkColorScheme} intensity={0.6} />
      <View className="flex-row items-center justify-between gap-3 border-b border-border px-5 pb-3.5 pt-2">
        <View className="flex-1">
          <Text className="text-[19px] font-bold tracking-tight">{title}</Text>
          {!!subtitle && (
            <Text className="mt-[3px] text-[13px] text-muted-foreground">
              {subtitle}
            </Text>
          )}
        </View>
        <View className="flex-row items-center gap-2.5">
          {headerRight}
          {editSwitch && <ModeToggle {...editSwitch} />}
          <Pressable
            onPress={() => router.back()}
            accessibilityLabel={t("Close")}
            className="h-10 w-10 items-center justify-center"
          >
            <X size={20} className="text-muted-foreground" />
          </Pressable>
        </View>
      </View>

      {/*
        `flex-1` so this scroll region takes exactly the space between the
        fixed header and the pinned footer (and scrolls internally rather
        than growing to fit its content and shoving the footer around). On
        Android `softwareKeyboardLayoutMode: "resize"` (`app.config.ts`)
        shrinks the screen on keyboard show and RN auto-scrolls the focused
        native TextInput into view; the WebView note editor scrolls itself
        via `useScrollIntoViewOnFocus` above.
      */}
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          ref={scrollViewRef}
          className="flex-1 px-5 pt-4"
          contentContainerStyle={{
            paddingBottom:
              footer != null ? FOOTER_CLEARANCE + insets.bottom : 32 + insets.bottom,
          }}
          keyboardShouldPersistTaps="handled"
        >
          <SessionFormScrollContext.Provider value={scrollViewRef}>
            {children}
          </SessionFormScrollContext.Provider>
        </ScrollView>

        {footer != null && (
          // Glass over the scrolling form, pinned to the bottom edge.
          <View
            pointerEvents="box-none"
            style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}
          >
            <Glass
              radius={0}
              clear
              intensity={60}
              style={{
                borderWidth: 0,
                borderTopWidth: StyleSheet.hairlineWidth,
                paddingHorizontal: 20,
                paddingTop: 12,
                paddingBottom: insets.bottom + 12,
              }}
            >
              {footer}
            </Glass>
          </View>
        )}
      </KeyboardAvoidingView>
    </View>
  );
}
