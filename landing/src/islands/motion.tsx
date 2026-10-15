import { LazyMotion, MotionConfig } from "motion/react";
import type { ReactNode } from "react";

/** Animation features load in their own chunk after the island hydrates. */
const features = () => import("./features").then((m) => m.default);

/** Every island renders inside this: `m.*` only, and OS reduced motion turns transforms off. */
export function Motion({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={features} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}
