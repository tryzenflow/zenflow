import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { Toaster as Sonner, ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      // Always render toasts at full height/position instead of sonner's
      // default collapsed-stack-until-hover look — that default causes a
      // visible downward shift the instant the cursor enters the stack.
      expand
      // Tint each toast by type: green success, red error, yellow warning,
      // blue info. The per-type CSS variables below feed sonner's rich colors.
      richColors
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",

          // Literal oklch values from Tailwind's palette so they resolve
          // regardless of which color utilities the build happens to emit.
          // Each type gets a soft tint on --popover plus a stronger border/text.

          // Success — emerald
          "--success-bg":
            "color-mix(in oklab, oklch(0.696 0.17 162.48) 12%, var(--popover))",
          "--success-text": "oklch(0.596 0.145 163.225)",
          "--success-border":
            "color-mix(in oklab, oklch(0.696 0.17 162.48) 35%, var(--border))",

          // Error — rose
          "--error-bg":
            "color-mix(in oklab, oklch(0.645 0.246 16.439) 12%, var(--popover))",
          "--error-text": "oklch(0.586 0.222 17.585)",
          "--error-border":
            "color-mix(in oklab, oklch(0.645 0.246 16.439) 35%, var(--border))",

          // Warning — amber
          "--warning-bg":
            "color-mix(in oklab, oklch(0.769 0.188 70.08) 14%, var(--popover))",
          "--warning-text": "oklch(0.666 0.179 58.318)",
          "--warning-border":
            "color-mix(in oklab, oklch(0.769 0.188 70.08) 38%, var(--border))",

          // Info — blue
          "--info-bg":
            "color-mix(in oklab, oklch(0.623 0.214 259.815) 12%, var(--popover))",
          "--info-text": "oklch(0.546 0.245 262.881)",
          "--info-border":
            "color-mix(in oklab, oklch(0.623 0.214 259.815) 35%, var(--border))",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
