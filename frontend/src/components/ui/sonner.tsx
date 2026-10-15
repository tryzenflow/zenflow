import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Toaster as Sonner, ToasterProps } from "sonner";
import { cn } from "@/lib/utils";

/** Small colored glyph in a soft tinted disc — the only color a toast carries. */
function ToastIcon({
  className,
  children,
}: {
  className: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "flex size-8 items-center justify-center rounded-full",
        className,
      )}
    >
      {children}
    </span>
  );
}

const TOASTER = "[data-sonner-toaster]";

/**
 * iOS-style notification stack: toasts pile up collapsed (only the newest is
 * fully visible) and fan out when the pile is *clicked* — not on hover, which
 * is sonner's default. Sonner has no controlled "expanded" state, so we drive
 * its `expand` prop ourselves: a click inside the toaster reveals the stack, a
 * click anywhere else folds it back, and hover events inside the toaster are
 * swallowed before sonner's hover-to-expand handler can see them.
 */
function useClickToExpand() {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const inToaster = (e: Event) =>
      e.target instanceof Element && e.target.closest(TOASTER) !== null;
    const onClick = (e: MouseEvent) => setExpanded(inToaster(e));
    const blockHover = (e: Event) => {
      if (inToaster(e)) e.stopPropagation();
    };
    document.addEventListener("click", onClick);
    const hover = ["mouseover", "mouseout", "mousemove"] as const;
    for (const t of hover) window.addEventListener(t, blockHover, true);
    return () => {
      document.removeEventListener("click", onClick);
      for (const t of hover) window.removeEventListener(t, blockHover, true);
    };
  }, []);

  return expanded;
}

const Toaster = ({ ...props }: ToasterProps) => {
  // The app has no next-themes provider (dark mode is just the `.dark` class),
  // so `useTheme()` would fall back to "system" and sonner would go dark with
  // the OS while the page stays light — black toast, unreadable dark title.
  // Follow the page's own class instead.
  const theme = document.documentElement.classList.contains("dark")
    ? "dark"
    : "light";
  const expanded = useClickToExpand();

  return (
    <Sonner
      theme={theme}
      position="bottom-right"
      className="toaster group"
      // Collapsed stack until clicked (see `useClickToExpand`).
      expand={expanded}
      // Auto-dismiss after a few seconds (sonner's default is 4s; pinned here).
      duration={4000}
      // iOS-notification look: one neutral glass surface (`.glass-notice` in
      // index.css); type is signalled only by the small tinted icon.
      icons={{
        success: (
          <ToastIcon className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
            <CircleCheckIcon className="size-4" />
          </ToastIcon>
        ),
        info: (
          <ToastIcon className="bg-sky-500/15 text-sky-600 dark:text-sky-400">
            <InfoIcon className="size-4" />
          </ToastIcon>
        ),
        warning: (
          <ToastIcon className="bg-amber-500/15 text-amber-600 dark:text-amber-400">
            <TriangleAlertIcon className="size-4" />
          </ToastIcon>
        ),
        error: (
          <ToastIcon className="bg-rose-500/15 text-rose-600 dark:text-rose-400">
            <OctagonXIcon className="size-4" />
          </ToastIcon>
        ),
        loading: (
          <ToastIcon className="bg-muted text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" />
          </ToastIcon>
        ),
      }}
      toastOptions={{
        classNames: {
          toast: "glass-notice group/toast",
          title: "!text-[13.5px] !font-semibold !text-foreground",
          description:
            "!text-[12.5px] !leading-snug line-clamp-none !text-muted-foreground",
          icon: "!ml-0 !mr-0 !size-8 !rounded-full !p-0",
          actionButton: "!bg-primary !text-primary-foreground !rounded-lg",
          cancelButton: "!bg-muted !text-muted-foreground !rounded-lg",
        },
      }}
      style={
        {
          // Sonner hard-codes a system font stack on the toaster; pin it to the
          // app's Geist so title + description inherit it.
          // (`--font-sans` lives in `@theme inline`, so it isn't a runtime var.)
          fontFamily: '"Geist", "Geist Fallback", system-ui, sans-serif',
          "--normal-text": "var(--foreground)",
          "--border-radius": "1rem", // rounded-2xl
          "--width": "28rem",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
