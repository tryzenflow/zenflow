import { startTransition, useEffect, useState } from "react";

/**
 * `false` on the first render, `true` once that frame has painted. A screen
 * draws its frame and a skeleton first, then renders its data in a later,
 * interruptible render, so opening it never stalls on the heavy part.
 */
export function useAfterPaint() {
  const [painted, setPainted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() =>
      startTransition(() => setPainted(true)),
    );
    return () => cancelAnimationFrame(id);
  }, []);
  return painted;
}
