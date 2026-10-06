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
