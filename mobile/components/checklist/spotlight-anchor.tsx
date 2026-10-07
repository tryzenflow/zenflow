import { Spotlight } from "@/components/checklist/spotlight";
import { useSpotlight } from "@/hooks/use-spotlight";
import { type Rect, isOnScreen } from "@/lib/spotlight";
import type { ChecklistStep } from "@zenflow/shared";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  StyleSheet,
  View,
  type ViewInstance,
  useWindowDimensions,
} from "react-native";

/** Let the screen settle (a sheet closing, a tab switching) before measuring. */
const SETTLE_MS = 450;
const RETRY_MS = 300;
const MAX_TRIES = 10;
/** After the first measure: this many unchanged re-measures, this far apart. */
const SETTLE_CHECKS = 2;
const SETTLE_CHECK_MS = 300;

/** The anchor is a plain native view (no NativeWind wrapper) that only gets measured. */
const RAW_VIEW = { cssInterop: false } as object;

/**
 * Drop this inside the control a checklist step's "show me" should point at; it
 * fills the control. When the user taps that step in the checklist
 * (`useSpotlight`), and this screen is focused, it measures the control and
 * shows the spotlight. Mount it only on the one control per screen to point at.
 */
export function SpotlightAnchor({
  step,
  ignoreFocus = false,
}: {
  step: ChecklistStep;
  /** For controls outside a screen (the tab bar), which has no focus of its own. */
  ignoreFocus?: boolean;
}) {
  return ignoreFocus ? (
    <Anchor step={step} focused />
  ) : (
    <FocusGatedAnchor step={step} />
  );
}

/** Only the focused screen answers (Week and Month are both mounted). */
function FocusGatedAnchor({ step }: { step: ChecklistStep }) {
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  return <Anchor step={step} focused={focused} />;
}

function Anchor({ step, focused }: { step: ChecklistStep; focused: boolean }) {
  const requested = useSpotlight((s) => s.step === step);
  const ref = useRef<ViewInstance>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const { width, height } = useWindowDimensions();
  const size = useRef({ width, height });
  size.current = { width, height };

  const active = requested && focused;

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // A control inside a sliding sheet (or a list still scrolling into place)
    // is "on screen" mid-motion; keep re-measuring until it holds still so the
    // spotlight doesn't end up where the control used to be.
    const settle = (prev: Rect, n: number) => {
      if (n >= SETTLE_CHECKS) return;
      timer = setTimeout(() => {
        if (cancelled || !ref.current) return;
        ref.current.measureInWindow((x, y, w, h) => {
          if (cancelled || w <= 0 || h <= 0) return;
          const next = { x, y, width: w, height: h };
          const moved =
            Math.abs(next.x - prev.x) > 1 || Math.abs(next.y - prev.y) > 1;
          if (moved) setRect(next);
          settle(next, moved ? 0 : n + 1);
        });
      }, SETTLE_CHECK_MS);
    };
    const attempt = (tries: number) => {
      if (cancelled) return;
      const retry = () => {
        if (tries < MAX_TRIES) timer = setTimeout(() => attempt(tries + 1), RETRY_MS);
      };
      if (!ref.current) return retry();
      ref.current.measureInWindow((x, y, w, h) => {
        if (cancelled) return;
        const r = { x, y, width: w, height: h };
        if (w > 0 && h > 0 && isOnScreen(r, size.current)) {
          setRect(r);
          useSpotlight.getState().markShown();
          settle(r, 0);
        } else {
          retry();
        }
      });
    };
    timer = setTimeout(() => attempt(0), SETTLE_MS);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      setRect(null);
    };
  }, [active]);

  // Rotation / split-screen: re-measure so the spotlight stays on its control.
  // biome-ignore lint/correctness/useExhaustiveDependencies: width/height are the trigger
  useEffect(() => {
    if (!rect) return;
    ref.current?.measureInWindow((x, y, w, h) => {
      if (w > 0 && h > 0) setRect({ x, y, width: w, height: h });
    });
  }, [width, height]);

  return (
    <>
      <View
        {...RAW_VIEW}
        ref={ref}
        collapsable={false}
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
      />
      {active && rect ? (
        <Spotlight
          step={step}
          rect={rect}
          onDismiss={() => useSpotlight.getState().clear()}
        />
      ) : null}
    </>
  );
}

/**
 * Drop inside the grid cell the "Move a task to another day" demo should land
 * on. While that step is requested it publishes the cell's window rect
 * (`useSpotlight.dragTarget`) for the demo finger; no overlay of its own.
 */
export function DragTargetProbe() {
  const requested = useSpotlight((s) => s.step === "move-day");
  const ref = useRef<ViewInstance>(null);
  useEffect(() => {
    if (!requested) return;
    let cancelled = false;
    const measure = () =>
      ref.current?.measureInWindow((x, y, w, h) => {
        if (!cancelled && w > 0 && h > 0) {
          useSpotlight.getState().setDragTarget({ x, y, width: w, height: h });
        }
      });
    // The day sheet slides up over the grid first; the cell itself never moves.
    const timers = [400, 900].map((ms) => setTimeout(measure, ms));
    return () => {
      cancelled = true;
      for (const timer of timers) clearTimeout(timer);
      useSpotlight.getState().setDragTarget(null);
    };
  }, [requested]);
  return (
    <View
      {...RAW_VIEW}
      ref={ref}
      collapsable={false}
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
    />
  );
}
