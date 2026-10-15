import { cn } from "@/lib/utils";

/**
 * Zenflow sunrise mark — mirrors `public/logo.svg` (the favicon/PWA icon):
 * a warm orange→amber→lime gradient disc with a pale flowing "zen" stroke.
 * The mixed gradient keeps the mark from reading as a flat single-amber blob.
 *
 * Animation: a continuous, gentle "breathing" scale on the mark plus a
 * hover-driven lift + rotate on the wrapper (kept on separate elements so the
 * two `transform`s don't fight). Both are gated behind `motion-safe:` so
 * reduced-motion users get a static mark.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex origin-center transition-transform duration-500 ease-out",
        "motion-safe:hover:rotate-12 motion-safe:hover:scale-110",
        className,
      )}
    >
      <svg
        viewBox="0 0 260 260"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="size-full origin-center motion-safe:animate-breathe"
        aria-hidden="true"
      >
        <circle cx="130" cy="130" r="130" fill="url(#zenflow-sunrise)" />
        <path
          d="M220.5 51.5C220.5 51.5 172.668 65.7587 147.635 89.6235C122.602 113.488 136.249 158.201 104.912 183.517C80.2542 203.436 32.9999 199.5 32.9999 199.5"
          stroke="#FFF085"
          strokeWidth="24"
          strokeLinecap="round"
        />
        <defs>
          <linearGradient
            id="zenflow-sunrise"
            x1="48.5"
            y1="31.5"
            x2="222.5"
            y2="220.5"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#FF6900" />
            <stop offset="0.323567" stopColor="#F0B100" />
            <stop offset="1" stopColor="#D8F999" />
          </linearGradient>
        </defs>
      </svg>
    </span>
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
