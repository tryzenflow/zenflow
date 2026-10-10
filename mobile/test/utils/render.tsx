import { type RenderOptions, render } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { PortalHost } from "@/components/primitives/portal";
import { ToastProvider } from "@/components/ui/toast";

// Mirrors the root layout: sheets and dialogs render through `PortalHost`.
function Providers({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      {children}
      <PortalHost />
    </ToastProvider>
  );
}

export function renderScreen(ui: ReactElement, options?: RenderOptions) {
  return render(ui, { wrapper: Providers, ...options });
}
