import { type FormFieldKey, firstInvalidField } from "@/lib/form-validation";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
} from "react";
import {
  AccessibilityInfo,
  type ScrollViewInstance,
  type ViewInstance,
  findNodeHandle,
} from "react-native";
import { useReducedMotion } from "react-native-reanimated";

interface FieldHandle {
  node: ViewInstance | null;
  /** Text inputs focus the keyboard; other fields take screen-reader focus. */
  focus?: () => void;
}

type Measurable = {
  measureInWindow: (
    cb: (x: number, y: number, w: number, h: number) => void,
  ) => void;
};

export interface SessionFormFocus {
  scrollRef: React.RefObject<ScrollViewInstance | null>;
  onScroll: (y: number) => void;
  register: (key: FormFieldKey, handle: FieldHandle | null) => void;
  /**
   * Scroll the first invalid field into view and focus it. `false` when no
   * invalid field is on screen (the caller falls back to a toast).
   */
  focusFirstInvalid: (errors: Record<string, unknown>) => boolean;
}

/** Owned by the create/edit screen; the screen and its fields share it by context. */
export function useSessionFormFocus(): SessionFormFocus {
  const reduced = useReducedMotion();
  const scrollRef = useRef<ScrollViewInstance | null>(null);
  const scrollY = useRef(0);
  const fields = useRef(new Map<FormFieldKey, FieldHandle>());

  const register = useCallback(
    (key: FormFieldKey, handle: FieldHandle | null) => {
      if (handle) fields.current.set(key, handle);
      else fields.current.delete(key);
    },
    [],
  );

  const focusFirstInvalid = useCallback(
    (errors: Record<string, unknown>) => {
      const key = firstInvalidField(errors);
      if (!key) return false;
      // A field inside "More details" only mounts after the disclosure opens.
      setTimeout(() => {
        const handle = fields.current.get(key);
        const scroll = scrollRef.current as unknown as Measurable | null;
        const node = handle?.node as unknown as Measurable | null | undefined;
        if (!handle || !node || !scroll) return;
        node.measureInWindow((_x, y) => {
          scroll.measureInWindow((_sx, sy) => {
            scrollRef.current?.scrollTo({
              y: Math.max(0, scrollY.current + (y - sy) - 24),
              animated: !reduced,
            });
            setTimeout(
              () => {
                if (handle.focus) handle.focus();
                else {
                  const tag = handle.node && findNodeHandle(handle.node);
                  if (tag) AccessibilityInfo.setAccessibilityFocus(tag);
                }
              },
              reduced ? 0 : 280,
            );
          });
        });
      }, 90);
      return true;
    },
    [reduced],
  );

  return useMemo(
    () => ({
      scrollRef,
      onScroll: (y: number) => {
        scrollY.current = y;
      },
      register,
      focusFirstInvalid,
    }),
    [register, focusFirstInvalid],
  );
}

export const SessionFormFocusContext = createContext<SessionFormFocus | null>(
  null,
);

export function useFormFieldRegistration() {
  return useContext(SessionFormFocusContext)?.register ?? null;
}
