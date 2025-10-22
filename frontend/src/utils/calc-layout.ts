import { Schedule } from "../types/schedule";

export interface ScheduleWithLayout extends Schedule {
  isOverlapping: boolean;
  columnIndex: number;
  totalColumns: number;
}
// Helper function to create a unique identifier for each specific schedule block/split
const getScheduleKey = (s: Schedule) => `${s.task.id}-${s.date}-${s.split}`;

export const calculateLayout = (
  schedules: Schedule[]
): ScheduleWithLayout[] => {
  if (schedules.length === 0) {
    return [];
  }

  // 1. Sort schedules by start time (essential for the greedy column assignment)
  const sortedSchedules = [...schedules].sort((a, b) => {
    const startA = new Date(a.start!).getTime();
    const startB = new Date(b.start!).getTime();
    if (startA !== startB) return startA - startB;
    return new Date(a.end!).getTime() - new Date(b.end!).getTime();
  });

  // 2. Initialize tracking structures
  // ActiveColumns tracks the end time of the last event placed in that column.
  const activeColumns: { end: number }[] = [];
  // LayoutMap stores the final calculated properties, keyed by the unique schedule key.
  const layoutMap: Record<
    string,
    { columnIndex: number; totalColumns: number; overlaps: boolean }
  > = {};

  // 3. First Pass: Assign initial column index and detect initial overlaps
  for (let i = 0; i < sortedSchedules.length; i++) {
    const currentSchedule = sortedSchedules[i];
    const scheduleKey = getScheduleKey(currentSchedule);
    const start = new Date(currentSchedule.start!).getTime();
    const end = new Date(currentSchedule.end!).getTime();
    let assignedColumn = -1;
    let overlaps = false;

    // Find the first column where the new schedule fits (starts after the column's last end time)
    for (let j = 0; j < activeColumns.length; j++) {
      if (start >= activeColumns[j].end) {
        assignedColumn = j;
        activeColumns[j].end = end; // Update the column's end time
        break;
      }
    }

    // If no column fits, create a new column
    if (assignedColumn === -1) {
      assignedColumn = activeColumns.length;
      activeColumns.push({ end });
    }

    // Check for any overlap with previously processed schedules to set the status
    // Note: A true overlap check should consider ALL other schedules, not just previous ones,
    // but the column assignment implicitly handles local overlap groups.
    for (const otherSchedule of schedules) {
      if (currentSchedule === otherSchedule) continue;

      const otherStart = new Date(otherSchedule.start!).getTime();
      const otherEnd = new Date(otherSchedule.end!).getTime();

      // Check for overlap: current interval [start, end] intersects other interval [otherStart, otherEnd]
      if (start < otherEnd && end > otherStart) {
        overlaps = true;
        break;
      }
    }

    layoutMap[scheduleKey] = {
      columnIndex: assignedColumn,
      totalColumns: 1, // Placeholder: will be corrected in the second pass
      overlaps: overlaps,
    };
  }

  // 4. Second Pass: Determine the correct local 'totalColumns' (Max Overlap) for each schedule
  const finalLayouts: ScheduleWithLayout[] = [];

  for (const schedule of schedules) {
    const scheduleKey = getScheduleKey(schedule);
    const start = new Date(schedule.start!).getTime();
    const end = new Date(schedule.end!).getTime();

    // Count how many schedules (including the current one) overlap at this time
    let maxOverlaps = 0;

    for (const otherSchedule of schedules) {
      const otherStart = new Date(otherSchedule.start!).getTime();
      const otherEnd = new Date(otherSchedule.end!).getTime();

      // Check for overlap between the two intervals
      if (start < otherEnd && end > otherStart) {
        maxOverlaps++;
      }
    }

    const { columnIndex, overlaps } = layoutMap[scheduleKey];

    finalLayouts.push({
      ...schedule,
      isOverlapping: overlaps,
      columnIndex: columnIndex,
      // Total columns for this specific group is the maximum number of concurrent overlaps found
      totalColumns: maxOverlaps,
    });
  }

  return finalLayouts;
};
