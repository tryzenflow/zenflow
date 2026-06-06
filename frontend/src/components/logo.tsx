import { cn } from "@/lib/utils";

/**
 * Zenflow "Zen Node" mark — a geometric symbol of structured flow.
 * Matches docs/mockups/logo.html: grid frame + dashed tracks + two flow paths
 * + a violet focal node. Strokes use `currentColor`; the node uses the theme
 * primary (violet).
 */
export function Logo({ className }: { className?: string }) {
  return (
    <svg
      // Full viewBox with the mark's natural margin (it spans 20–80). Keeping
      // the margin means it scales up crisp instead of cropping in and reading
      // oversized. Mirrors the inline mark in docs/mockups (sidebar SVG).
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("text-foreground", className)}
      aria-hidden="true"
    >
      <path
        d="M20 20H80V80H20V20Z"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ opacity: 0.12 }}
      />
      <path
        d="M20 35H50C55.5 35 60 39.5 60 45V80"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ opacity: 0.4 }}
      />
      <path
        d="M40 20V55C40 60.5 44.5 65 50 65H80"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ opacity: 0.8 }}
      />
      <rect x="52" y="32" width="16" height="16" rx="4" className="fill-primary" />
    </svg>
  );
}

/** Logo + "Zenflow" wordmark lockup. */
export function Wordmark({
  className,
  iconClassName,
}: {
  className?: string;
  iconClassName?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Logo className={cn("h-9 w-9 shrink-0", iconClassName)} />
      <span className="text-xl font-semibold tracking-tight">Zenflow</span>
    </div>
  );
}
