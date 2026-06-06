import { useUserStore } from "@/hooks/use-user-store";
import { DEFAULT_WORK_PREFS, getDayZones } from "@/utils/zones";

const HOURS = Array.from({ length: 24 }, (_, i) => i);

/**
 * The static backdrop of a single day column: a card base with off-hours /
 * weekend zone tints and subtle hour gridlines. Sits behind the droppable
 * cells and task blocks (pointer-events-none), so drops still land on cells.
 */
export function DayColumnBackground({ date }: { date: Date }) {
  const prefs =
    useUserStore((s) => s.user) ?? DEFAULT_WORK_PREFS;
  const { isWorkDay, workStartPx, workEndPx } = getDayZones(date, prefs);

  return (
    <div className="pointer-events-none absolute inset-0">
      {/* Zone tints over the card base. */}
      {isWorkDay ? (
        <>
          <div
            className="zone-nonwork absolute inset-x-0 top-0"
            style={{ height: workStartPx }}
          />
          <div
            className="zone-nonwork absolute inset-x-0 bottom-0"
            style={{ top: workEndPx }}
          />
        </>
      ) : (
        <div className="zone-weekend absolute inset-0" />
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
