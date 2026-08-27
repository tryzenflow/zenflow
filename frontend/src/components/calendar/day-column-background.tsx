const HOURS = Array.from({ length: 24 }, (_, i) => i);

/**
 * The static backdrop of a single day column: a card base with subtle hour
 * gridlines. Sits behind the droppable cells and task blocks
 * (pointer-events-none), so drops still land on cells.
 *
 * This used to also tint "outside working hours" / weekend zones
 * (`@zenflow/core`'s `getDayZones`/`DEFAULT_WORK_PREFS`) — dropped along with
 * the `workStart`/`workEnd`/`workDays` fields on `User` (education-pivot
 * migration; see `@zenflow/shared`'s `user.ts`). There is no working-hours
 * concept left to shade.
 */
export function DayColumnBackground() {
  return (
    <div className="pointer-events-none absolute inset-0">
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
