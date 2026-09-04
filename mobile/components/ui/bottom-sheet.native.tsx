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
      children,
      keyboardBehavior = "fillParent",
      keyboardBlurBehavior = "restore",
      ...props
    },
    ref,
  ) => {
    const insets = useSafeAreaInsets();
    const { isDarkColorScheme } = useColorScheme();
    const { colors } = useTheme();
    const { sheetRef } = useBottomSheetContext();

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
        keyboardBehavior={keyboardBehavior}
        keyboardBlurBehavior={keyboardBlurBehavior}
        {...props}
      >
        <BottomSheetContext.Provider value={{ sheetRef }}>
          {/* `BottomSheetModal`'s `children` prop type also allows a
              `(data) => ReactNode` render-prop form (for the generic
              `present(data)` payload feature) — none of this app's sheets
              use that form, only plain JSX, so this is a safe narrowing. */}
          {children as React.ReactNode}
        </BottomSheetContext.Provider>
      </BottomSheetModal>
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
      style={{ fontFamily: "Geist" }}
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
        "border-b border-border flex-row items-center justify-between px-4 pb-3",
        className,
      )}
      {...props}
    >
      {children}
      {/* Matches `task-form-screen.tsx`'s header close button (`h-8 w-8
          rounded-full bg-muted`) instead of a plain ghost icon button, for a
          consistent close-affordance look across the sheeted and full-screen
          flows. */}
      <Button
        onPress={close}
        variant="ghost"
        accessibilityLabel="Close"
        className="h-8 w-8 aspect-square self-start rounded-full bg-muted p-0 flex items-center justify-center"
      >
        <X className="text-muted-foreground" size={16} />
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
