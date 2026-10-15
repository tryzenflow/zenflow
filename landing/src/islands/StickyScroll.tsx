import { AnimatePresence, m, useMotionValueEvent, useScroll, useSpring, useTransform } from "motion/react";
import { type CSSProperties, useRef, useState } from "react";
import { Motion } from "./motion";

export interface StickyScrollProps {
  beats: { title: string; body: string }[];
  sources: string[];
  task: { title: string; minutes: string; time: string };
  placed: string;
}

const TINTS = ["var(--color-accent)", "var(--color-primary)", "var(--color-lime)"];

/** Aceternity sticky scroll reveal with a tracing beam: three beats of text; the card beside them follows the one in view. */
export default function StickyScroll(props: StickyScrollProps) {
  return (
    <Motion>
      <Beats {...props} />
    </Motion>
  );
}

function Beats(props: StickyScrollProps) {
  const ref = useRef<HTMLOListElement>(null);
  const [active, setActive] = useState(0);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start center", "end center"] });
  useMotionValueEvent(scrollYProgress, "change", (p) =>
    setActive(Math.min(props.beats.length - 1, Math.max(0, Math.floor(p * props.beats.length)))),
  );
  const beam = useSpring(useTransform(scrollYProgress, [0, 1], [0, 1]), { stiffness: 300, damping: 40 });

  return (
    <div className="grid gap-10 md:grid-cols-2 md:gap-16">
      <ol ref={ref} className="relative space-y-16 pl-14 md:space-y-[38vh] md:py-[18vh]">
        <span aria-hidden="true" className="absolute top-0 bottom-0 left-[17px] w-0.5 rounded-full bg-rule" />
        <m.span
          aria-hidden="true"
          style={{ scaleY: beam }}
          className="absolute top-0 bottom-0 left-[17px] w-0.5 origin-top rounded-full bg-linear-to-b from-orange via-accent to-lime shadow-[0_0_12px_var(--color-primary)]"
        />
        {props.beats.map((beat, i) => (
          <li key={beat.title} className="relative transition-opacity duration-300 md:opacity-[var(--o)]" style={{ "--o": i === active ? 1 : 0.35 } as CSSProperties}>
            <span
              className={`absolute -left-14 inline-flex size-9 items-center justify-center rounded-full text-sm font-extrabold transition-colors duration-300 ${
                i <= active ? "bg-primary text-primary-fg shadow-[0_0_0_6px_var(--glow)]" : "border border-rule bg-card text-muted"
              }`}
            >
              {i + 1}
            </span>
            <h3 className="pt-1 text-2xl font-extrabold tracking-tight md:text-3xl">{beat.title}</h3>
            <p className="mt-2 max-w-md text-lg text-muted">{beat.body}</p>
            <div className="mt-6 md:hidden">
              <Card index={i} {...props} />
            </div>
          </li>
        ))}
      </ol>
      <div className="hidden md:block">
        <div className="sticky top-[calc(50vh-11rem)]">
          <AnimatePresence mode="wait" initial={false}>
            <m.div
              key={active}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              transition={{ duration: 0.3 }}
            >
              <Card index={active} {...props} />
            </m.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function Card({ index, sources, task, placed }: StickyScrollProps & { index: number }) {
  const tint = TINTS[index];
  return (
    <div
      aria-hidden="true"
      className="relative flex h-80 items-center justify-center overflow-hidden rounded-[28px] border border-rule p-8"
      style={{ background: `radial-gradient(80% 80% at 30% 20%, color-mix(in srgb, ${tint} 28%, transparent), transparent 70%), var(--card)` }}
    >
      {index === 0 && (
        <div className="flex w-full max-w-xs flex-col gap-3">
          {sources.map((s, i) => (
            <div key={s} className="flex items-center gap-3 rounded-2xl border border-rule bg-bg px-4 py-3 font-semibold shadow-sm">
              <span className="size-2.5 rounded-full" style={{ background: i ? "var(--color-exam)" : "var(--color-lecture)" }} />
              {s}
              <span className="ml-auto size-2.5 rounded-full bg-done" />
            </div>
          ))}
          <div className="mx-auto h-8 w-px bg-rule" />
          <div className="grid grid-cols-5 gap-1.5 rounded-2xl border border-rule bg-bg p-3">
            {Array.from({ length: 15 }, (_, i) => (
              <span
                key={i}
                className="block-session h-5 rounded-md"
                style={{ "--kind": [3, 7, 11].includes(i) ? "var(--color-exam)" : i % 2 ? "var(--color-lecture)" : "var(--color-rule)" } as CSSProperties}
              />
            ))}
          </div>
        </div>
      )}
      {index === 1 && (
        <div className="w-full max-w-xs rounded-2xl border border-rule bg-bg p-4 shadow-sm">
          <div className="rounded-xl border-2 border-primary px-3 py-2.5 text-lg font-semibold">
            {task.title}
            <span className="ml-0.5 inline-block h-5 w-0.5 translate-y-1 animate-pulse bg-primary" />
          </div>
          <div className="mt-3 flex gap-2 text-sm">
            <span className="rounded-full bg-accent px-3 py-1 font-semibold text-primary-fg">{task.minutes}</span>
            <span className="block-session rounded-full px-3 py-1 font-semibold [--kind:var(--color-assignment)]">{task.time}</span>
          </div>
        </div>
      )}
      {index === 2 && (
        <div className="relative w-full max-w-xs space-y-1.5">
          {["lecture", "rule", "task", "exam", "rule"].map((k, i) => (
            <div
              key={i}
              className={`block-session rounded-lg px-3 ${k === "task" ? "py-3 font-semibold shadow-[0_10px_24px_-10px_var(--color-task)]" : "h-9"}`}
              style={{ "--kind": `var(--color-${k})` } as CSSProperties}
            >
              {k === "task" ? task.title : null}
            </div>
          ))}
          <div className="absolute -right-3 top-6 flex items-center gap-1.5 rounded-2xl border border-rule bg-card px-3 py-2 text-xs font-bold shadow-lg">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-done)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12.5l4.2 4.2L19 7" />
            </svg>
            {placed}
          </div>
        </div>
      )}
    </div>
  );
}
