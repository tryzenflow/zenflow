import {
  type ToastFn,
  ToastProvider,
  normalizeToastArgs,
  useToast,
} from "@/components/ui/toast";
import { type ReactNode, createContext, useContext, useMemo } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";

type ToastApi = ReturnType<typeof useToast>;

const RootToastContext = createContext<ToastApi | null>(null);

/**
 * The root-layout `ToastProvider` paints its stack as a sibling of the
 * navigator. A `presentation: "modal"` screen (the task create/edit forms) is
 * a separate native view controller on iOS, stacked above that — so a toast
 * fired from the form was drawn *behind* the modal, invisible. That is why a
 * failed save looked like it "silently failed".
 *
 * This scope mounts a second `ToastProvider` inside the modal's own view
 * hierarchy; use {@link useModalToast} below it.
 */
export function ModalToastScope({ children }: { children: ReactNode }) {
  const root = useToast();
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ToastProvider>
        <RootToastContext.Provider value={root}>
          {children}
        </RootToastContext.Provider>
      </ToastProvider>
    </GestureHandlerRootView>
  );
}

/**
 * `toast`/`confirm` for a form living in a {@link ModalToastScope}. Errors and anything with action buttons (the infeasible-policy prompt)
 * must be seen while the modal is still up, so they go to the in-modal stack.
 * Everything else (success, warnings, tips, "moved N tasks") is fired right before the
 * screen is replaced, so it goes to the root stack and survives the dismissal.
 */
export function useModalToast(): ToastApi {
  const local = useToast();
  const root = useContext(RootToastContext) ?? local;
  return useMemo<ToastApi>(
    () => ({
      toast: ((...args: Parameters<ToastFn>) => {
        const input = normalizeToastArgs(args);
        const target =
          input.variant === "destructive" ||
          input.action ||
          input.actions?.length
            ? local
            : root;
        target.toast(input);
      }) as ToastFn,
      confirm: local.confirm,
      removeToast: local.removeToast,
    }),
    [local, root],
  );
}
