import { X } from "@/components/Icons";
import { Text } from "@/components/ui/text";
import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

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
export function TaskFormScreen({
  title,
  subtitle,
  headerRight,
  footer,
  children,
}: {
  title: string;
  subtitle?: string;
  headerRight?: ReactNode;
  footer: ReactNode;
  children: ReactNode;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center justify-between gap-3 border-b border-border px-5 pb-3.5 pt-2">
        <View className="flex-1">
          <Text className="text-[19px] font-bold tracking-tight">{title}</Text>
          {!!subtitle && (
            <Text className="mt-[3px] text-[13px] text-muted-foreground">
              {subtitle}
            </Text>
          )}
        </View>
        <View className="flex-row items-center gap-3.5">
          {headerRight}
          <Pressable
            onPress={() => router.back()}
            accessibilityLabel="Close"
            className="h-8 w-8 items-center justify-center rounded-full bg-muted"
          >
            <X size={16} className="text-muted-foreground" />
          </Pressable>
        </View>
      </View>

      {/*
        Keyboard-aware wrapper for everything below the fixed header: on iOS
        there's no OS-level window resize on keyboard show (unlike Android's
        `softwareKeyboardLayoutMode: "resize"`, set in `app.config.ts`), so
        `KeyboardAvoidingView`'s `padding` behavior is what pushes the scroll
        content + footer up above the keyboard. On Android the OS resize
        already shrinks this View's available height, so `undefined`
        behavior (no extra offset) avoids double-compensating — this View
        just needs to remain `flex-1` so the ScrollView/footer below reflow
        into whatever height Android leaves it.
      */}
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          className="flex-1 px-5 pt-4"
          contentContainerStyle={{ paddingBottom: 32 }}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>

        <View
          className="border-t border-border bg-background px-5 pt-3.5 shadow-lg shadow-primary/10"
          style={{ paddingBottom: insets.bottom + 14 }}
        >
          {footer}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
