import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { FindSchedulesDto } from "../schedules/dto/find-schedules.dto";
import { DateTime } from "luxon";
import { differenceInDays } from "date-fns";

@Injectable()
export class AnalyticsService {
  constructor(private prisma: PrismaService) {}

  async getDashboardSummary(
    userId: string,
    timezone: string,
    dto: FindSchedulesDto
  ) {
    // ---------- 1. Convert start/end to TZ-aware, then to UTC for DB query ----------
    const startDate = DateTime.fromISO(dto.start, { zone: timezone })
      .startOf("day")
      .toUTC()
      .toJSDate();
    const endDate = DateTime.fromISO(dto.end, { zone: timezone })
      .endOf("day")
      .toUTC()
      .toJSDate();

    // ---------- 2. Pull all required data ----------
    const [tasks, schedules, constraints] = await Promise.all([
      this.prisma.task.findMany({
        where: {
          userId,
          schedules: { some: { date: { gte: startDate, lte: endDate } } },
        },
        include: { category: true },
      }),

      this.prisma.schedule.findMany({
        where: {
          task: { userId },
          start: { gte: startDate },
          end: { lte: endDate },
        },
        include: { task: { include: { category: true } } },
      }),

      this.prisma.constraint.findMany({ where: { userId } }),
    ]);

    // ---------- 3. Map schedules to user timezone ----------
    const schedulesInTZ = schedules.map((s) => ({
      ...s,
      start: s.start ? DateTime.fromJSDate(s.start).setZone(timezone) : null,
      end: s.end ? DateTime.fromJSDate(s.end).setZone(timezone) : null,
    }));

    // ---------- 4. Total scheduled minutes ----------
    const totalScheduledTime = schedulesInTZ.reduce((sum, s) => {
      if (!s.start || !s.end) return sum;
      return sum + s.end.diff(s.start, "minutes").minutes;
    }, 0);

    const highFocusTime = schedulesInTZ.reduce((sum, s) => {
      if (!s.start || !s.end) return sum;
      if (s.task.focus === 3) {
        return sum + s.end.diff(s.start, "minutes").minutes;
      }
      return sum;
    }, 0);

    // ---------- 5. Utilization ----------
    const dailyMinutes = constraints.reduce(
      (sum, c) => sum + c.maxDailyLoad,
      0
    );
    const utilization = dailyMinutes ? totalScheduledTime / dailyMinutes : 0;

    // ---------- 6. Scheduled vs pending ----------
    const scheduledTaskIds = new Set(schedules.map((s) => s.taskId));
    const tasksScheduledCount = scheduledTaskIds.size;
    const tasksPendingCount = tasks.length - tasksScheduledCount;

    // ---------- 7. Energy/focus alignment ----------
    const energyAlignment = { highFocus: 0, mediumFocus: 0, lowFocus: 0 };
    for (const s of schedulesInTZ) {
      if (!s.start || !s.end) continue;
      const minutes = s.end.diff(s.start, "minutes").minutes;
      switch (s.task.focus) {
        case 3:
          energyAlignment.highFocus += minutes;
          break;
        case 2:
          energyAlignment.mediumFocus += minutes;
          break;
        default:
          energyAlignment.lowFocus += minutes;
      }
    }

    // ---------- 8. Daily load ----------
    const dailyLoad = {
      maxLoad: constraints.length
        ? Math.max(...constraints.map((c) => c.maxDailyLoad))
        : 0,
      scheduled: highFocusTime / (differenceInDays(endDate, startDate) + 1),
    };

    // ---------- 9. Category distribution ----------
    const categoryMap = new Map<
      string,
      { minutes: number; name: string | null }
    >();
    for (const s of schedulesInTZ) {
      if (!s.start || !s.end) continue;
      const cat = s.task.category?.id ?? "Uncategorized";
      const minutes = s.end.diff(s.start, "minutes").minutes;
      categoryMap.set(cat, {
        minutes: (categoryMap.get(cat)?.minutes ?? 0) + minutes,
        name: s.task.category?.name ?? null,
      });
    }
    const categoryDistribution = Array.from(categoryMap.entries()).map(
      ([id, { minutes, name }]) => ({
        id,
        name,
        minutes: Math.round(minutes),
      })
    );

    // ---------- 10. Context switches ----------
    const sorted = schedulesInTZ
      .filter((s) => s.start)
      .sort((a, b) => a.start!.toMillis() - b.start!.toMillis());

    let contextSwitches = 0;
    let totalGaps = 0;
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      if (prev.taskId !== curr.taskId) contextSwitches++;
      if (prev.end && curr.start) {
        const gap = curr.start.diff(prev.end, "minutes").minutes;
        if (gap > 0) totalGaps += gap;
      }
    }
    const avgGap = contextSwitches ? totalGaps / contextSwitches : 0;

    // ---------- 11. Return summary ----------
    return {
      totalScheduledTime: Math.round(totalScheduledTime),
      utilization: parseFloat(utilization.toFixed(2)),
      tasksScheduled: tasksScheduledCount,
      tasksPending: tasksPendingCount,
      energyAlignment: {
        highFocus: Math.round(energyAlignment.highFocus),
        mediumFocus: Math.round(energyAlignment.mediumFocus),
        lowFocus: Math.round(energyAlignment.lowFocus),
      },
      dailyLoad,
      categoryDistribution,
      contextSwitches: {
        count: contextSwitches,
        avgGap: Math.round(avgGap),
      },
    };
  }
}
