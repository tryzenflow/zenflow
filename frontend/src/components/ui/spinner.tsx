import { cn } from "@/lib/utils";

/** The logo's middle curve (components/logo.tsx). */
const CURVE =
  "M220.5 51.5C220.5 51.5 172.668 65.7587 147.635 89.6235C122.602 113.488 136.249 158.201 104.912 183.517C80.2542 203.436 32.9999 199.5 32.9999 199.5";

/** Trails first so the lead curve paints on top; see `.zf-spinner` in index.css. */
const LAYERS = [
  { n: 4, width: 20 },
  { n: 3, width: 24 },
  { n: 2, width: 28 },
  { n: 1, width: 32 },
  { n: 0, width: 34 },
] as const;

/**
 * Loading mark: the logo curve turns once, eases to rest and drags fading
 * trails behind it (mockups/brand-loader.html). Drawn in `currentColor`;
 * size it with `size-*`.
 */
export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 260 260"
      fill="none"
      role="progressbar"
      aria-label="Loading"
      className={cn("zf-spinner size-4 shrink-0", className)}
    >
      {LAYERS.map(({ n, width }) => (
        <path
          key={n}
          data-trail={n}
          d={CURVE}
          stroke="currentColor"
          strokeWidth={width}
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}
