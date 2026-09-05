import { X } from "@/components/Icons";
import * as DialogPrimitive from "@/components/primitives/dialog";
import * as Slot from "@/components/primitives/slot";
import { cn } from "@/lib/utils";
import * as React from "react";
import {
  FlatList as RNFlatList,
  type GestureResponderEvent,
  Pressable,
  ScrollView as RNScrollView,
  StyleSheet,
  TextInput as RNTextInput,
  View,
  type ViewStyle,
} from "react-native";
import { Button } from "./button";

// !IMPORTANT: This file is only for web.
//
// This reimplements the same BottomSheet* API on top of the Dialog primitive
// (Radix under the hood) — a modal anchored to the bottom of the viewport
// instead of centered — so callers share one API cross-platform, without
// pulling in `@gorhom/bottom-sheet`'s own gesture-driven sheet chrome
// (`<BottomSheetModal>`) on web.
//
// Because `BottomSheetContent` here is NOT a real `@gorhom/bottom-sheet`
// instance, any `@gorhom/bottom-sheet` component that depends on that
// package's own internal context (e.g. its `BottomSheetScrollView`, which
// reads `useBottomSheetInternal()`) throws if used as a child on web — see
// this file's own `BottomSheetScrollView` below for the cross-platform-safe
// replacement. Callers should get every `BottomSheet*` piece they need from
// `@/components/ui/bottom-sheet`, not mix in bare `@gorhom/bottom-sheet`
// imports for anything that renders inside a sheet's body.

/** Minimal subset of the @gorhom/bottom-sheet imperative API this file mirrors. */
interface WebSheetHandle {
  present: () => void;
  dismiss: () => void;
  /** Native's `close()` animates the sheet away but — with
   * `enableDismissOnClose={false}` — keeps its children mounted, which is what
   * lets a gesture that started on a sheet row survive the sheet closing (see
   * `SessionListSheet`). There's nothing to keep alive in this Radix-based
   * reimplementation, so it's just `dismiss()`. */
  close: () => void;
}

type BottomSheetRef = React.ElementRef<typeof View>;
type BottomSheetProps = React.ComponentPropsWithoutRef<typeof View>;

interface BottomSheetContext {
  sheetRef: React.RefObject<WebSheetHandle | null>;
}

const BottomSheetContext = React.createContext({} as BottomSheetContext);

const BottomSheet = React.forwardRef<BottomSheetRef, BottomSheetProps>(
  ({ ...props }, ref) => {
    const sheetRef = React.useRef<WebSheetHandle>(null);
    return (
      <BottomSheetContext.Provider value={{ sheetRef }}>
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

type BottomSheetContentRef = WebSheetHandle;
type BottomSheetContentProps = Omit<
  React.ComponentPropsWithoutRef<typeof View>,
  "style"
> & {
  onDismiss?: () => void;
  style?: ViewStyle;
  /** Accepted for API parity with `bottom-sheet.native.tsx`, and ignored: the
   * overlay here is the Radix `Dialog.Overlay` below, which has no snap-point-
   * driven opacity to tune. Declared (and destructured out) so callers can
   * pass it unconditionally without it leaking onto the DOM node. */
  backdropProps?: Record<string, unknown>;
  /** Accepted for API parity with `bottom-sheet.native.tsx`, and ignored —
   * this reimplementation has no mounted-but-closed state to preserve. */
  enableDismissOnClose?: boolean;
};

const BottomSheetContent = React.forwardRef<
  BottomSheetContentRef,
  BottomSheetContentProps
>(
  (
    {
      className,
      children,
      onDismiss,
      backdropProps: _backdropProps,
      enableDismissOnClose: _enableDismissOnClose,
      ...props
    },
    ref,
  ) => {
    const [open, setOpen] = React.useState(false);
    const { sheetRef } = useBottomSheetContext();

    const handle = React.useMemo<WebSheetHandle>(
      () => ({
        present: () => setOpen(true),
        dismiss: () => setOpen(false),
        close: () => setOpen(false),
      }),
      [],
    );
    React.useImperativeHandle(sheetRef, () => handle, [handle]);
    React.useImperativeHandle(ref, () => handle, [handle]);

    const wasOpen = React.useRef(open);
    React.useEffect(() => {
      if (wasOpen.current && !open) onDismiss?.();
      wasOpen.current = open;
    }, [open, onDismiss]);

    return (
      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay
            style={StyleSheet.absoluteFill}
            className={cn(
              "z-50 bg-black/50",
              open
                ? "web:animate-in web:fade-in-0"
                : "web:animate-out web:fade-out-0",
            )}
          />
          <DialogPrimitive.Content
            style={
              { position: "fixed", left: 0, right: 0, bottom: 0 } as ViewStyle
            }
            className={cn(
              "z-50 mx-auto flex max-h-[85vh] w-full max-w-[480px] flex-col overflow-hidden rounded-t-[26px] border border-b-0 border-border bg-background pb-6 pt-2.5 shadow-2xl",
              open
                ? "web:animate-in web:slide-in-from-bottom web:fade-in-0 web:duration-300"
                : "web:animate-out web:slide-out-to-bottom web:fade-out-0 web:duration-200",
              className,
            )}
            {...props}
          >
            <View className="mx-auto mb-3.5 h-[5px] w-[38px] shrink-0 rounded-full bg-border" />
            {children}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
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
  const { sheetRef } = useBottomSheetContext();
  function handleOnPress(ev: GestureResponderEvent) {
    sheetRef.current?.dismiss();
    onPress?.(ev);
  }
  const Trigger = asChild ? Slot.Pressable : Pressable;
  return <Trigger ref={ref} onPress={handleOnPress} {...props} />;
});

type BottomSheetViewProps = Omit<
  React.ComponentPropsWithoutRef<typeof View>,
  "style"
> & {
  hadHeader?: boolean;
  style?: ViewStyle;
};

function BottomSheetView({
  className,
  children,
  hadHeader: _hadHeader = true,
  style,
  ...props
}: BottomSheetViewProps) {
  return (
    <View className={cn("px-4", className)} style={style} {...props}>
      {children}
    </View>
  );
}

type BottomSheetTextInputRef = React.ElementRef<typeof RNTextInput>;
type BottomSheetTextInputProps = React.ComponentPropsWithoutRef<
  typeof RNTextInput
>;
const BottomSheetTextInput = React.forwardRef<
  BottomSheetTextInputRef,
  BottomSheetTextInputProps
>(({ className, placeholderClassName, ...props }, ref) => {
  return (
    <RNTextInput
      ref={ref}
      className={cn(
        "web:flex h-10 native:h-12 web:w-full rounded-md border border-input bg-background px-3 web:py-2 text-base lg:text-sm native:text-lg native:leading-[1.25] text-foreground placeholder:text-muted-foreground web:ring-offset-background file:border-0 file:bg-transparent file:font-medium web:focus-visible:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring web:focus-visible:ring-offset-2",
        props.editable === false && "opacity-50 web:cursor-not-allowed",
        className,
      )}
      placeholderClassName={cn("text-muted-foreground", placeholderClassName)}
      style={{ fontFamily: "Geist" }}
      {...props}
    />
  );
});

type BottomSheetFlatListRef = React.ElementRef<typeof RNFlatList>;
type BottomSheetFlatListProps = React.ComponentPropsWithoutRef<
  typeof RNFlatList
>;
const BottomSheetFlatList = React.forwardRef<
  BottomSheetFlatListRef,
  BottomSheetFlatListProps
>(({ className, style, ...props }, ref) => {
  return (
    <RNFlatList
      ref={ref}
      // A bare `max-h-*` class on a web FlatList doesn't reliably bound the
      // scroll container (react-native-web renders it via a nested inner
      // View whose height Tailwind's class targets the wrong element), so
      // fall back to an explicit numeric height unless the caller overrides.
      style={[{ maxHeight: 340 }, style]}
      className={cn("py-4", className)}
      keyboardShouldPersistTaps="handled"
      {...props}
    />
  );
});

type BottomSheetScrollViewRef = React.ElementRef<typeof RNScrollView>;
type BottomSheetScrollViewProps = React.ComponentPropsWithoutRef<
  typeof RNScrollView
>;
/**
 * Plain `ScrollView` wrapper — added so `create-task-sheet.tsx` /
 * `edit-task-sheet.tsx` can import
 * `BottomSheetScrollView` from here instead of straight from
 * `@gorhom/bottom-sheet`. That mattered: `@gorhom/bottom-sheet`'s own
 * `BottomSheetScrollView` reads `useBottomSheetInternal()`, a context only a
 * *real* `@gorhom/bottom-sheet` `<BottomSheet>`/`<BottomSheetModal>` instance
 * provides — fine on native (`bottom-sheet.native.tsx`'s `BottomSheetContent`
 * renders a real one), but on web `BottomSheetContent` is this file's Radix
 * `Dialog`-based reimplementation (see the file header), which never
 * provides that context. Importing gorhom's own `BottomSheetScrollView`
 * directly meant every task sheet's content — including
 * `SessionSheetFields`/`TagAutocomplete`/`DescriptionField` — rendered inside a
 * component that unconditionally throws `"'useBottomSheetInternal' cannot
 * be used out of the BottomSheet!"` on web, the only target this repo can
 * currently run locally (CLAUDE.md: "Mobile dev … web target only"). A
 * plain `ScrollView` here (mirroring `BottomSheetFlatList` below, which
 * already avoided this trap) needs no such context and behaves the same way
 * a scrollable sheet body should on web.
 */
const BottomSheetScrollView = React.forwardRef<
  BottomSheetScrollViewRef,
  BottomSheetScrollViewProps
>(({ className, ...props }, ref) => {
  return (
    <RNScrollView
      ref={ref}
      className={cn("flex-1", className)}
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
    sheetRef.current?.dismiss();
  }
  return (
    <View
      ref={ref}
      className={cn(
        "border-b border-border flex-row items-center justify-between px-4",
        className,
      )}
      {...props}
    >
      {children}
      {/* Matches `task-form-screen.tsx`'s header close button (`h-8 w-8
          rounded-full bg-muted`) instead of a plain ghost icon button, for a
          consistent close-affordance look across the sheeted and full-screen
          flows — same treatment as the native file's `BottomSheetHeader`. */}
      <Button
        onPress={close}
        variant="ghost"
        accessibilityLabel="Close"
        className="h-8 w-8 self-start rounded-full bg-muted p-0"
      >
        <X className="text-muted-foreground" size={16} />
      </Button>
    </View>
  );
});

type BottomSheetFooterRef = React.ElementRef<typeof View>;
type BottomSheetFooterProps = React.ComponentPropsWithoutRef<typeof View>;

/** Kept for API parity with the native file; no callers currently use it. */
const BottomSheetFooter = React.forwardRef<
  BottomSheetFooterRef,
  BottomSheetFooterProps
>(({ className, children, ...props }, ref) => {
  return (
    <View ref={ref} className={cn("px-4 pt-1.5", className)} {...props}>
      {children}
    </View>
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
