import type {
  BottomSheetBackdropProps,
  BottomSheetFooterProps as GBottomSheetFooterProps,
} from "@gorhom/bottom-sheet";
import {
  BottomSheetBackdrop,
  BottomSheetFlatList as GBottomSheetFlatList,
  BottomSheetFooter as GBottomSheetFooter,
  BottomSheetModal,
  // Re-exported as-is below (not wrapped) — on native, `BottomSheetContent`
  // here always renders a real `@gorhom/bottom-sheet` `<BottomSheetModal>`,
  // so `BottomSheetScrollView`'s own `useBottomSheetInternal()` context read
  // is always satisfied. Re-exporting it from this file (instead of every
  // caller importing it straight from `@gorhom/bottom-sheet`) just keeps one
  // import path (`@/components/ui/bottom-sheet`) that resolves correctly on
  // both platforms — see `bottom-sheet.tsx` (web)'s version of this export
  // for why that matters there.
  BottomSheetScrollView,
  BottomSheetTextInput as GBottomSheetTextInput,
  BottomSheetView as GBottomSheetView,
} from "@gorhom/bottom-sheet";
import type { BottomSheetModalMethods } from "@gorhom/bottom-sheet/lib/typescript/types";
import { useTheme } from "@react-navigation/native";
import { cssInterop } from "nativewind";
import * as React from "react";
import {
  type GestureResponderEvent,
  Keyboard,
  Pressable,
  View,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { X } from "../../components/Icons";
import { useColorScheme } from "../../lib/useColorScheme";
import { cn } from "../../lib/utils";
import * as Slot from "../primitives/slot";
import { Button } from "./button";

// `GBottomSheetTextInput` wraps a `TextInput` from `react-native-gesture-handler`,
// not the plain `react-native` one NativeWind auto-interops — without this, its
// `className` is a no-op string prop and typed text falls back to RN's default
// black, regardless of theme (the border/background props are set imperatively
// below via `backgroundStyle`/etc., so only the input text itself was affected).
cssInterop(GBottomSheetTextInput, {
  className: "style",
  placeholderClassName: {
    target: false,
    nativeStyleToProp: { color: "placeholderTextColor" },
  },
});

// TODO: refactor and move to UI
// TODO: create web component, use https://ui.shadcn.com/docs/components/drawer

type BottomSheetRef = React.ElementRef<typeof View>;
type BottomSheetProps = React.ComponentPropsWithoutRef<typeof View>;

interface BottomSheetContext {
  // `BottomSheetModal` is a generic type alias in @gorhom/bottom-sheet v5
  // (`type BottomSheetModal<T = never> = BottomSheetModalMethods<T>`), not a
  // component class — `React.ElementRef<typeof BottomSheetModal>` no longer
  // resolves cleanly against it, so the ref is typed against the imperative
  // methods interface directly instead (same shape `BottomSheetModal<never>`
  // aliases to).
  sheetRef: React.RefObject<BottomSheetModalMethods | null>;
}

const BottomSheetContext = React.createContext({} as BottomSheetContext);

const BottomSheet = React.forwardRef<BottomSheetRef, BottomSheetProps>(
  ({ ...props }, ref) => {
    const sheetRef = React.useRef<BottomSheetModalMethods>(null);

    return (
      <BottomSheetContext.Provider value={{ sheetRef: sheetRef }}>
        <View ref={ref} {...props} />
      </BottomSheetContext.Provider>
    );
  },
);

function useBottomSheetContext() {
  const context = React.useContext(BottomSheetContext);
  if (!context) {
    throw new Error(
      "BottomSheet compound components cannot be rendered outside the BottomSheet component",
    );
  }
  return context;
}

const CLOSED_INDEX = -1;

type BottomSheetContentRef = BottomSheetModalMethods;

type BottomSheetContentProps = Omit<
  React.ComponentPropsWithoutRef<typeof BottomSheetModal>,
  "backdropComponent"
> & {
  backdropProps?: Partial<
    React.ComponentPropsWithoutRef<typeof BottomSheetBackdrop>
  >;
};

const BottomSheetContent = React.forwardRef<
  BottomSheetContentRef,
  BottomSheetContentProps
>(
  (
    {
      enablePanDownToClose = true,
      enableDynamicSizing = true,
      index = 0,
      backdropProps,
      backgroundStyle,
      android_keyboardInputMode = "adjustResize",
      ...props
    },
    ref,
  ) => {
    const insets = useSafeAreaInsets();
    const { isDarkColorScheme } = useColorScheme();
    const { colors } = useTheme();
    const { sheetRef } = useBottomSheetContext();

    // Merge the caller-supplied `ref` (e.g. `useBottomSheet()`'s ref, used by
    // every sheet including `CreateTaskSheet`/`EditTaskSheet`/
    // `ChangeDurationSheet` — see their doc comments for why the earlier
    // `useControlledBottomSheet` external-`open`-prop bridge was retired)
    // with the `<BottomSheet>` wrapper's own context `sheetRef` (what
    // `BottomSheetOpenTrigger`/`BottomSheetCloseTrigger`/`BottomSheetHeader`
    // read via context): both need to end up pointing at the same live
    // `BottomSheetModal` instance.
    //
    // This used to be a `useImperativeHandle(ref, () => sheetRef.current ?? {}, [sheetRef.current])`
    // — but `sheetRef.current` is a plain mutable ref, not reactive state, so
    // that dependency array is only ever re-evaluated on a render this
    // component happens to re-run for some *other* reason. On mount,
    // `@gorhom/bottom-sheet` attaches the real `BottomSheetModal` instance to
    // `sheetRef` slightly after this component's own first commit (it mounts
    // its portalled content on a later tick), so the imperative handle's
    // *first* run captured `sheetRef.current` while it was still `null`,
    // returned the `{}` stub, and then had no reason to run again — leaving
    // `ref.current` (the caller's ref) permanently stubbed out, so
    // `ref.current?.present()` silently no-op'd forever. This only "worked"
    // for sheets that happened to re-render again shortly after mount for an
    // unrelated reason (e.g. `EditTaskSheet`'s `getTaskDetails().then(setTask)`),
    // which is exactly why `CreateTaskSheet`'s FAB / empty-area long-press
    // (no such follow-up render) never opened while tap-to-edit did.
    //
    // Assigning both refs directly in a merged callback ref instead avoids
    // the staleness: it fires exactly when React attaches/detaches the real
    // instance, no matter when that happens.
    const setRefs = React.useCallback(
      (instance: BottomSheetModalMethods | null) => {
        sheetRef.current = instance;
        if (typeof ref === "function") ref(instance);
        else if (ref) ref.current = instance;
      },
      [ref, sheetRef],
    );

    const renderBackdrop = React.useCallback(
      (props: BottomSheetBackdropProps) => {
        const {
          pressBehavior = "close",
          opacity = isDarkColorScheme ? 0.3 : 0.7,
          disappearsOnIndex = CLOSED_INDEX,
          style,
          onPress,
          ...rest
        } = {
          ...props,
          ...backdropProps,
        };
        return (
          <BottomSheetBackdrop
            opacity={opacity}
            disappearsOnIndex={disappearsOnIndex}
            pressBehavior={pressBehavior}
            style={[{ backgroundColor: "rgba(0,0,0,0.8)" }, style]}
            onPress={() => {
              if (Keyboard.isVisible()) {
                Keyboard.dismiss();
              }
              onPress?.();
            }}
            {...rest}
          />
        );
      },
      [backdropProps, colors],
    );

    return (
      <BottomSheetModal
        ref={setRefs}
        index={0}
        enablePanDownToClose={enablePanDownToClose}
        backdropComponent={renderBackdrop}
        enableDynamicSizing={enableDynamicSizing}
        backgroundStyle={[{ backgroundColor: colors.card }, backgroundStyle]}
        handleIndicatorStyle={{
          backgroundColor: colors.text,
        }}
        topInset={insets.top}
        android_keyboardInputMode={android_keyboardInputMode}
        {...props}
      />
    );
  },
);

const BottomSheetOpenTrigger = React.forwardRef<
  React.ElementRef<typeof Pressable>,
  React.ComponentPropsWithoutRef<typeof Pressable> & {
    asChild?: boolean;
  }
>(({ onPress, asChild = false, ...props }, ref) => {
  const { sheetRef } = useBottomSheetContext();
  function handleOnPress(ev: GestureResponderEvent) {
    sheetRef.current?.present();
    onPress?.(ev);
  }
  const Trigger = asChild ? Slot.Pressable : Pressable;
  return <Trigger ref={ref} onPress={handleOnPress} {...props} />;
});

const BottomSheetCloseTrigger = React.forwardRef<
  React.ElementRef<typeof Pressable>,
  React.ComponentPropsWithoutRef<typeof Pressable> & {
    asChild?: boolean;
  }
>(({ onPress, asChild = false, ...props }, ref) => {
  // Local per-instance `sheetRef` from this `<BottomSheet>`'s own context —
  // NOT `useBottomSheetModal()`'s ambient `dismiss()` (see `BottomSheetHeader`
  // below for why that's the wrong tool here).
  const { sheetRef } = useBottomSheetContext();
  function handleOnPress(ev: GestureResponderEvent) {
    sheetRef.current?.dismiss();
    if (Keyboard.isVisible()) {
      Keyboard.dismiss();
    }
    onPress?.(ev);
  }
  const Trigger = asChild ? Slot.Pressable : Pressable;
  return <Trigger ref={ref} onPress={handleOnPress} {...props} />;
});

const BOTTOM_SHEET_HEADER_HEIGHT = 60; // BottomSheetHeader height

type BottomSheetViewProps = Omit<
  React.ComponentPropsWithoutRef<typeof GBottomSheetView>,
  "style"
> & {
  hadHeader?: boolean;
  style?: ViewStyle;
};

function BottomSheetView({
  className,
  children,
  hadHeader = true,
  style,
  ...props
}: BottomSheetViewProps) {
  const insets = useSafeAreaInsets();
  return (
    <GBottomSheetView
      style={[
        {
          paddingBottom:
            insets.bottom + (hadHeader ? BOTTOM_SHEET_HEADER_HEIGHT : 0),
        },
        style,
      ]}
      className={cn(`px-4`, className)}
      {...props}
    >
      {children}
    </GBottomSheetView>
  );
}

type BottomSheetTextInputRef = React.ElementRef<typeof GBottomSheetTextInput>;
type BottomSheetTextInputProps = React.ComponentPropsWithoutRef<
  typeof GBottomSheetTextInput
>;
const BottomSheetTextInput = React.forwardRef<
  BottomSheetTextInputRef,
  BottomSheetTextInputProps
>(({ className, placeholderClassName, ...props }, ref) => {
  return (
    <GBottomSheetTextInput
      ref={ref}
      className={cn(
        "rounded-md border border-input bg-background px-3 text-xl h-14 leading-[1.25] text-foreground items-center  placeholder:text-muted-foreground disabled:opacity-50",
        className,
      )}
      placeholderClassName={cn("text-muted-foreground", placeholderClassName)}
      {...props}
    />
  );
});

type BottomSheetFlatListRef = React.ElementRef<typeof GBottomSheetFlatList>;
type BottomSheetFlatListProps = React.ComponentPropsWithoutRef<
  typeof GBottomSheetFlatList
>;
const BottomSheetFlatList = React.forwardRef<
  BottomSheetFlatListRef,
  BottomSheetFlatListProps
>(({ className, ...props }, ref) => {
  const insets = useSafeAreaInsets();
  return (
    <GBottomSheetFlatList
      ref={ref}
      contentContainerStyle={[{ paddingBottom: insets.bottom }]}
      className={cn("py-4", className)}
      keyboardShouldPersistTaps="handled"
      {...props}
    />
  );
});

type BottomSheetHeaderRef = React.ElementRef<typeof View>;
type BottomSheetHeaderProps = React.ComponentPropsWithoutRef<typeof View>;
const BottomSheetHeader = React.forwardRef<
  BottomSheetHeaderRef,
  BottomSheetHeaderProps
>(({ className, children, ...props }, ref) => {
  // Was `useBottomSheetModal().dismiss()` (no key) — `@gorhom/bottom-sheet`
  // dismisses whichever sheet is *last in its shared, app-wide presented-
  // sheets queue* when no key is given (see
  // `BottomSheetModalProvider.tsx`'s `handleDismiss`), which is only ever
  // "this sheet" by coincidence. On a screen with multiple independent
  // nested sheets — the task form's `TagAutocomplete` sheet alongside
  // `DeadlineChipRow`'s `InlineDateField`/`InlineTimeField` sheets, all
  // siblings sharing one `BottomSheetModalProvider` — that queue can end up
  // with a stale entry on top: `@gorhom/bottom-sheet`'s own
  // `BottomSheetModalProvider`'s `handleWillUnmountSheet` (fired when a
  // modal's `Portal` unmounts mid-dismiss, e.g. `InlineTimeField`'s sheet
  // being torn down because `DeadlineChipRow`'s `chip` state changed away
  // while that sheet's own close animation was still in flight) never
  // splices that sheet's key out of the shared queue — only a *clean*
  // dismiss-to-completion does, via `unmountSheet`. `useBottomSheetContext()`
  // gives this exact `<BottomSheet>` instance's own `sheetRef` instead — the
  // same one `BottomSheetOpenTrigger` already uses to *open* this sheet — so
  // closing is deterministic regardless of what else is or isn't cleanly
  // registered in that shared queue. (The web reimplementation in
  // `bottom-sheet.tsx` already did it this way — this brings native in line
  // with it.)
  const { sheetRef } = useBottomSheetContext();
  function close() {
    if (Keyboard.isVisible()) {
      Keyboard.dismiss();
    }
    sheetRef.current?.dismiss();
  }
  return (
    <View
      ref={ref}
      className={cn(
        "border-b border-border flex-row items-center justify-between pl-4",
        className,
      )}
      {...props}
    >
      {children}
      <Button onPress={close} variant="ghost" className="pr-4">
        <X className="text-muted-foreground" size={24} />
      </Button>
    </View>
  );
});

type BottomSheetFooterRef = React.ElementRef<typeof View>;
type BottomSheetFooterProps = Omit<
  React.ComponentPropsWithoutRef<typeof View>,
  "style"
> & {
  bottomSheetFooterProps: GBottomSheetFooterProps;
  children?: React.ReactNode;
  style?: ViewStyle;
};

/**
 * To be used in a useCallback function as a props to BottomSheetContent
 */
const BottomSheetFooter = React.forwardRef<
  BottomSheetFooterRef,
  BottomSheetFooterProps
>(({ bottomSheetFooterProps, children, className, style, ...props }, ref) => {
  const insets = useSafeAreaInsets();
  return (
    <GBottomSheetFooter {...bottomSheetFooterProps}>
      <View
        ref={ref}
        style={[{ paddingBottom: insets.bottom + 6 }, style]}
        className={cn("px-4 pt-1.5", className)}
        {...props}
      >
        {children}
      </View>
    </GBottomSheetFooter>
  );
});

function useBottomSheet() {
  const ref = React.useRef<BottomSheetContentRef>(null);

  const open = React.useCallback(() => {
    ref.current?.present();
  }, []);

  const close = React.useCallback(() => {
    ref.current?.dismiss();
  }, []);

  return { ref, open, close };
}

export {
  BottomSheet,
  BottomSheetCloseTrigger,
  BottomSheetContent,
  BottomSheetFlatList,
  BottomSheetFooter,
  BottomSheetHeader,
  BottomSheetOpenTrigger,
  BottomSheetScrollView,
  BottomSheetTextInput,
  BottomSheetView,
  useBottomSheet,
};
