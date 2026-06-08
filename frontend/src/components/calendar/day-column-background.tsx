import { useUserStore } from "@/hooks/use-user-store";
import { DAY_PX, DEFAULT_WORK_PREFS, getDayZones } from "@/utils/zones";

const HOURS = Array.from({ length: 24 }, (_, i) => i);

/**
 * Given the work-hour segments, return the complementary non-work gaps that
 * should be tinted (in grid px). For a single mid-day window this yields the
 * familiar top + bottom bands; for an overnight window it yields the gap
 * between the morning spill-over and the evening shift.
 */
function nonWorkGaps(segments: { topPx: number; bottomPx: number }[]) {
  const sorted = [...segments].sort((a, b) => a.topPx - b.topPx);
  const gaps: { topPx: number; bottomPx: number }[] = [];
  let cursor = 0;
  for (const seg of sorted) {
    if (seg.topPx > cursor) gaps.push({ topPx: cursor, bottomPx: seg.topPx });
    cursor = Math.max(cursor, seg.bottomPx);
  }
  if (cursor < DAY_PX) gaps.push({ topPx: cursor, bottomPx: DAY_PX });
  return gaps;
}

/**
 * The static backdrop of a single day column: a card base with off-hours /
 * weekend zone tints and subtle hour gridlines. Sits behind the droppable
 * cells and task blocks (pointer-events-none), so drops still land on cells.
 */
export function DayColumnBackground({ date }: { date: Date }) {
  const prefs = useUserStore((s) => s.user) ?? DEFAULT_WORK_PREFS;
  const { segments } = getDayZones(date, prefs);

  return (
    <div className="pointer-events-none absolute inset-0">
      {/* Zone tints over the card base. A column with no work segments is a
          full non-work day → the softer weekend treatment; otherwise tint the
          gaps between work bands. */}
      {segments.length === 0 ? (
        <div className="zone-weekend absolute inset-0" />
      ) : (
        nonWorkGaps(segments).map((gap) => (
          <div
            key={gap.topPx}
            className="zone-nonwork absolute inset-x-0"
            style={{ top: gap.topPx, height: gap.bottomPx - gap.topPx }}
          />
        ))
      )}

      {/* Hour gridlines. */}
      <div className="absolute inset-0 flex flex-col">
        {HOURS.map((hour) => (
          <div
            key={hour}
            className="border-grid h-[var(--week-cells-height)] border-b last:border-b-0"
          />
        ))}
      </div>
    </div>
  );
}
