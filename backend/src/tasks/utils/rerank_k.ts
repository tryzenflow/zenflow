import { differenceInCalendarDays } from "date-fns";
import { SchedulerPrefs } from "../../scheduler/interfaces";
import { DAILY_HORIZON, TIME_GRANULARITY } from "../../common/constants";

export function getRerankK(
  deadline: Date,
  prefs: SchedulerPrefs,
  now = new Date(),
) {
  /**
   * Get the number of available candidates for reranking with Phase 2/Phase 3
   * 1. Get the number of 15-minute blocks from `now` to `deadline` (assuming `deadline` > `now`) that are within working hours (call it `n`)
   * 2. Take round(n / e) to get the number of candidates, max 500
   */
  const allBlocksCountFromNowToDeadline = Math.floor(
    (deadline.getTime() - now.getTime()) / (TIME_GRANULARITY * 60 * 1000),
  );
  const totalDailyBlocks = DAILY_HORIZON / TIME_GRANULARITY;
  const workBlocks = Math.floor(
    (prefs.workEnd - prefs.workStart) / TIME_GRANULARITY,
  );
  const numberOfUnavailableBlocks =
    (totalDailyBlocks - workBlocks) * differenceInCalendarDays(deadline, now);
  const numberOfRemainingBlocks =
    allBlocksCountFromNowToDeadline - numberOfUnavailableBlocks;
  const numberOfCandidatesToRerank = Math.round(
    numberOfRemainingBlocks / Math.E,
  );
  return Math.min(numberOfCandidatesToRerank, 500);
}
