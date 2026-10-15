import type { StudentTermMarksDto } from "@zenflow/shared";
import { t } from "./i18n";

export type Trend = "up" | "down" | "flat";

const TREND_STEP = 0.05;

/** Term GPA change vs the previous term, keyed `yearStudy|termId`. Terms are newest first. */
export function termTrends(
  terms: readonly StudentTermMarksDto[],
): Map<string, { trend: Trend; delta: number }> {
  const out = new Map<string, { trend: Trend; delta: number }>();
  terms.forEach((term, i) => {
    const prev = terms[i + 1];
    if (term.gpa4 === null || prev?.gpa4 == null) return;
    const delta = term.gpa4 - prev.gpa4;
    const trend: Trend =
      delta > TREND_STEP ? "up" : delta < -TREND_STEP ? "down" : "flat";
    out.set(`${term.yearStudy}|${term.termId}`, { trend, delta });
  });
  return out;
}

/** Share of graded, credit-bearing courses that are A, or A and B. */
export function gradeShare(terms: readonly StudentTermMarksDto[]): {
  total: number;
  a: number;
  ab: number;
} {
  let total = 0;
  let a = 0;
  let ab = 0;
  for (const term of terms) {
    for (const mark of term.marks) {
      if (mark.noCredit || !mark.letter) continue;
      total += 1;
      if (mark.letter === "A") a += 1;
      if (mark.letter === "A" || mark.letter === "B") ab += 1;
    }
  }
  return { total, a, ab };
}

/** One or two short sentences on how the student is doing. Empty when there is nothing to say. */
export function interpret(
  gpa4: number | null,
  terms: readonly StudentTermMarksDto[],
): string[] {
  if (gpa4 === null) return [];
  const lines: string[] = [];
  const { total, a, ab } = gradeShare(terms);
  if (total > 0) {
    const pctA = Math.round((a / total) * 100);
    const pctAb = Math.round((ab / total) * 100);
    if (gpa4 >= 3.6)
      lines.push(t("Excellent. {pct}% of courses are A", { pct: pctA }));
    else if (gpa4 >= 3.2)
      lines.push(t("Strong. {pct}% of courses are A or B", { pct: pctAb }));
    else if (gpa4 >= 2.5)
      lines.push(t("Solid. {pct}% of courses are A or B", { pct: pctAb }));
    else
      lines.push(
        t("Room to grow. {pct}% of courses are A or B", { pct: pctAb }),
      );
  }
  const latest =
    terms.length > 0
      ? termTrends(terms).get(`${terms[0].yearStudy}|${terms[0].termId}`)
      : undefined;
  if (latest) {
    const delta = Math.abs(latest.delta).toFixed(2);
    if (latest.trend === "up")
      lines.push(t("Up {delta} from last semester", { delta }));
    else if (latest.trend === "down")
      lines.push(t("Down {delta} from last semester", { delta }));
    else lines.push(t("Steady since last semester"));
  }
  return lines;
}
