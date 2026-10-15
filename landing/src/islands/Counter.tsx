import { useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

const DURATION = 1400;
const easeOut = (t: number) => 1 - (1 - t) ** 4;

/** Counts up to `value` once in view. Renders the final number on the server and with reduced motion. */
export default function Counter({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.8 });
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(value);
  const started = useRef(false);

  useEffect(() => {
    if (reduced || started.current) return;
    if (!inView) {
      setShown(0);
      return;
    }
    started.current = true;
    const t0 = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / DURATION);
      setShown(Math.round(easeOut(p) * value));
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [inView, reduced, value]);

  return (
    <span ref={ref} className="tabular-nums">
      {shown}
    </span>
  );
}
