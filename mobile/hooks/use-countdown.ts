import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A single mm:ss countdown, driven off a wall-clock target timestamp rather
 * than a naive decrementing interval, so it self-corrects even if the JS
 * timer loop is throttled (e.g. the app briefly backgrounds). Built for the
 * login screen's three OTP rate-limit cooldown/lockout states
 * (`app/(auth)/login.tsx` — issue #14: request lockout, resend cooldown,
 * verify lockout) so they share one interval/format implementation instead
 * of three copies.
 */
export function useCountdown() {
  const [remaining, setRemaining] = useState(0);
  const targetRef = useRef<number | null>(null);

  useEffect(() => {
    if (remaining <= 0) return;
    const id = setInterval(() => {
      const target = targetRef.current;
      if (target == null) return;
      setRemaining(Math.max(0, Math.ceil((target - Date.now()) / 1000)));
    }, 1000);
    return () => clearInterval(id);
    // Only re-arms the interval on the idle<->active transition — while
    // active it self-corrects off `targetRef` every tick, so it doesn't
    // need to reset on every `remaining` change.
  }, [remaining > 0]);

  const start = useCallback((seconds: number) => {
    if (seconds <= 0) return;
    targetRef.current = Date.now() + seconds * 1000;
    setRemaining(seconds);
  }, []);

  const clear = useCallback(() => {
    targetRef.current = null;
    setRemaining(0);
  }, []);

  return { remaining, active: remaining > 0, start, clear };
}

/** Formats whole seconds as `m:ss` (e.g. `58` → `"0:58"`, `552` → `"9:12"`). */
export function formatCountdown(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}
