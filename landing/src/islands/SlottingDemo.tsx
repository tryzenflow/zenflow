import { AnimatePresence, m, useInView, useReducedMotion } from "motion/react";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import type { DemoCopy } from "../content/copy";
import { SLOT, clock, placeTasks } from "../lib/slotting";
import { Motion } from "./motion";

const DAY_START = 8 * 60;
const DAY_END = 18 * 60;
const HOURS = [8, 10, 12, 14, 16, 18];
const KIND_COLOR = {
  lecture: "var(--color-lecture)",
  exam: "var(--color-exam)",
  assignment: "var(--color-assignment)",
  task: "var(--color-task)",
} as const;

const slots = (minutes: number) => minutes / SLOT;
const blockStyle = (start: number, end: number, kind: keyof typeof KIND_COLOR): CSSProperties =>
  ({
    top: `calc(var(--slot) * ${slots(start - DAY_START)})`,
    height: `calc(var(--slot) * ${slots(end - start)} - 2px)`,
    "--kind": KIND_COLOR[kind],
  }) as CSSProperties;

export default function SlottingDemo({ copy }: { copy: DemoCopy }) {
  return (
    <Motion>
      <Demo copy={copy} />
    </Motion>
  );
}

function Demo({ copy }: { copy: DemoCopy }) {
  const [added, setAdded] = useState<string[]>([]);
  const [touched, setTouched] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.5 });
  const reduced = useReducedMotion();

  const placed = useMemo(
    () =>
      placeTasks(
        copy.fixed,
        copy.tasks.filter((t) => added.includes(t.id)),
        DAY_START,
        DAY_END,
      ),
    [copy, added],
  );
  const last = copy.tasks.find((t) => t.id === added[added.length - 1]);
  const lastSlot = last && placed.get(last.id);
  const waiting = copy.tasks.filter((t) => !added.includes(t.id));

  // Show one placement on its own, unless the visitor got there first or prefers no motion.
  useEffect(() => {
    if (!inView || touched || reduced) return;
    const id = setTimeout(() => setAdded((a) => (a.length ? a : [copy.tasks[0].id])), 1200);
    return () => clearTimeout(id);
  }, [inView, touched, reduced, copy.tasks]);

  const add = (id: string) => {
    setTouched(true);
    setAdded((a) => [...a, id]);
  };

  return (
    <div
      ref={ref}
      className="relative w-full max-w-sm rounded-[28px] border border-rule bg-card p-4 shadow-[0_30px_60px_-24px_rgb(47_72_88/0.35)] [--slot:10px] sm:[--slot:11px]"
    >
      <div className="mb-3 flex items-baseline justify-between px-1">
        <span className="text-lg font-extrabold tracking-tight">{copy.day}</span>
        <span className="rounded-full bg-primary/12 px-2.5 py-0.5 text-xs font-semibold text-primary-ink dark:text-primary">
          {copy.today}
        </span>
      </div>

      <div className="relative ml-9" style={{ height: `calc(var(--slot) * ${slots(DAY_END - DAY_START)})` }} role="img" aria-label={copy.label}>
        {HOURS.map((h) => (
          <div
            key={h}
            className="absolute -left-9 right-0 flex items-center gap-2 text-[10px] text-muted"
            style={{ top: `calc(var(--slot) * ${slots(h * 60 - DAY_START)} - 6px)` }}
          >
            <span className="w-7 text-right tabular-nums">{h}:00</span>
            <span className="h-px flex-1 bg-rule" />
          </div>
        ))}

        {copy.fixed.map((b) => (
          <div
            key={b.title}
            className="block-session absolute inset-x-0 overflow-hidden rounded-lg px-2 py-0.5 text-[11px] leading-tight font-semibold"
            style={blockStyle(b.start, b.end, b.kind)}
          >
            {b.title}
          </div>
        ))}

        {copy.tasks.map((task) => {
          const slot = placed.get(task.id);
          if (!slot) return null;
          return (
            <m.div
              key={task.id}
              layoutId={task.id}
              transition={{ type: "spring", stiffness: 380, damping: 30 }}
              className="block-session absolute inset-x-0 flex items-start justify-between gap-2 overflow-hidden rounded-lg px-2 py-0.5 text-[11px] leading-tight font-semibold shadow-[0_8px_20px_-8px_var(--color-task)]"
              style={blockStyle(slot.start, slot.end, "task")}
            >
              <span>{task.title}</span>
              <span className="shrink-0 font-normal text-muted tabular-nums">
                {clock(slot.start)} – {clock(slot.end)}
              </span>
            </m.div>
          );
        })}
      </div>

      <div className="mt-4 min-h-[4.5rem]">
        {waiting.length > 0 ? (
          <>
            <p className="mb-2 px-1 text-xs text-muted">{copy.hint}</p>
            <ul className="flex flex-wrap gap-2">
              {waiting.map((task) => (
                <li key={task.id}>
                  <m.button
                    type="button"
                    layoutId={task.id}
                    onClick={() => add(task.id)}
                    whileHover={{ y: -2 }}
                    whileTap={{ scale: 0.96 }}
                    className="block-session cursor-pointer rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold [--kind:var(--color-task)]"
                  >
                    {task.title}
                    <span className="ml-1.5 font-normal text-muted">
                      {task.minutes} {copy.minutes}
                    </span>
                  </m.button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <div className="flex items-center justify-between gap-3 px-1">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <span className="size-2.5 rounded-full bg-done" aria-hidden="true" />
              {copy.allPlaced}
            </p>
            <button
              type="button"
              onClick={() => {
                setTouched(true);
                setAdded([]);
              }}
              className="cursor-pointer rounded-full border border-rule px-3 py-1 text-xs font-semibold text-muted hover:text-fg"
            >
              {copy.reset}
            </button>
          </div>
        )}
      </div>

      <div aria-live="polite" className="pointer-events-none absolute -bottom-6 right-3 sm:-right-6">
        <AnimatePresence mode="wait">
          {last && lastSlot && (
            <m.div
              key={last.id}
              initial={{ opacity: 0, y: 8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6 }}
              className="rounded-2xl border border-rule bg-card px-3 py-2 text-xs shadow-lg"
            >
              <p className="font-bold">{copy.placed}</p>
              <p className="text-muted">
                {clock(lastSlot.start)}, {last.reason === "exam" ? copy.beforeExam : copy.beforeDeadline}
              </p>
            </m.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
