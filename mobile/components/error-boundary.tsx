import { AlertTriangle } from "@/components/Icons";
import { Text } from "@/components/ui/text";
import * as React from "react";
import { View } from "react-native";

interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** Shown next to the warning icon in the fallback. */
  fallbackMessage?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Generic render-error containment boundary — React only exposes this via a
 * class component (`componentDidCatch`/`getDerivedStateFromError` have no
 * hook equivalent), so this is deliberately a `class`, unlike the rest of
 * this codebase's functional-components-only convention.
 *
 * Why this exists: without a *local* boundary, a render-time throw anywhere
 * in a subtree unwinds to the nearest ancestor boundary — which, absent one
 * here, is Expo Router's automatic per-route `ErrorBoundary` (re-exported in
 * `app/_layout.tsx`), unmounting the *entire* routed screen for a failure in
 * one unrelated field. First real use: `DescriptionField`
 * (`components/tasks/form/description-field.tsx`) mounts a
 * `react-native-webview`-backed native view the first time its sheet opens
 * (`@gorhom/bottom-sheet`'s `BottomSheetModal` defers mounting sheet content
 * until `present()` — see its `mount` state); if `react-native-webview` /
 * `@10play/tentap-editor` aren't yet linked into the running dev client (a
 * native rebuild is required after adding them — see `mobile/README.md`'s
 * pitfalls section — and wasn't verified on-device when they were wired up),
 * creating that native view throws during render. Unhandled, that crash
 * unwound the whole `(app)/index` Day-screen tree, which is why *every*
 * sheet-opening gesture (FAB, long-press-empty-area, tap-to-edit) appeared
 * broken at once — `CreateSessionSheet` and `EditSessionSheet` are siblings under
 * that same tree, so one field's crash took the other down with it, not
 * just its own sheet. Wrapping just the WebView-backed field keeps a
 * failure there contained to a small inline fallback instead.
 */
export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    if (__DEV__) {
      console.error("[ErrorBoundary]", error, info.componentStack);
    }
  }

  render() {
    if (this.state.error) {
      return (
        <View className="flex-row items-center gap-2 rounded-xl border border-dashed border-destructive/40 bg-destructive/5 px-3.5 py-3">
          <AlertTriangle size={16} className="text-destructive" />
          <Text className="flex-1 text-[12.5px] text-muted-foreground">
            {this.props.fallbackMessage ??
              "This part couldn't load. The rest of the form still works."}
          </Text>
        </View>
      );
    }
    return this.props.children;
  }
}
