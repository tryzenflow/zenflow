import { m, useReducedMotion, useScroll, useTransform } from "motion/react";
import { type ReactNode, useRef } from "react";
import { Motion } from "./motion";

/** Aceternity container scroll: the device tilts flat and settles as it scrolls into view. */
export default function ContainerScroll({ children }: { children?: ReactNode }) {
  return (
    <Motion>
      <Tilt>{children}</Tilt>
    </Motion>
  );
}

function Tilt({ children }: { children?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "center center"] });
  const rotateX = useTransform(scrollYProgress, [0, 1], [24, 0]);
  const scale = useTransform(scrollYProgress, [0, 1], [0.9, 1]);
  const y = useTransform(scrollYProgress, [0, 1], [40, 0]);

  return (
    <div ref={ref} className="[perspective:1000px]">
      <m.div style={reduced ? undefined : { rotateX, scale, y }} className="origin-bottom will-change-transform">
        {children}
      </m.div>
    </div>
  );
}
