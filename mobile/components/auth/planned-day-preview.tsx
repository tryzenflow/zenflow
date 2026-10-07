import { Sparkles } from "@/components/Icons";
import { Text } from "@/components/ui/text";
import { useLanguage } from "@/hooks/use-language";
import { sessionTypeTextClass } from "@/lib/session-type-class";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { SessionType } from "@zenflow/shared";
import { View } from "react-native";

type Row = {
  time: string;
  title: string;
  meta: string;
  type: SessionType;
  /** Left accent + tint, matching the real day-view block for that type. */
  block: string;
  planned?: boolean;
};

// Illustration only: made-up course names, never the student's data.
const ROWS: Row[] = [
  {
    time: "07:30",
    title: "Web Programming",
    meta: "Lecture · 07:30–09:00",
    type: "LECTURE",
    block: "border-l-sky-500 bg-sky-50/50 dark:bg-sky-950/20",
  },
  {
    time: "13:30",
    title: "Revise Data Structures",
    meta: "Study task · 13:30–14:30",
    type: "TASK",
    block: "border-l-primary bg-brand-orange/[0.18]",
    planned: true,
  },
  {
    time: "15:00",
    title: "Calculus midterm",
    meta: "Exam · 15:00–16:30",
    type: "EXAM",
    block: "border-l-rose-500 bg-rose-50/50 dark:bg-rose-950/20",
  },
];

/**
 * A small, labelled illustration of a planned day (lecture, study task, exam)
 * for the login hero. Built from the real block styles so it previews what the
 * app produces; "Example day" keeps it honest as an illustration.
 */
export function PlannedDayPreview() {
  useLanguage();
  return (
    <View
      accessible
      accessibilityLabel={t("Example day")}
      className="rounded-2xl border border-border bg-card p-3"
    >
      <Text className="mb-2 text-label font-semibold text-muted-foreground">
        {t("Example day")}
      </Text>
      <View className="gap-1.5">
        {ROWS.map((row) => (
          <View key={row.time} className="flex-row items-stretch gap-2">
            <Text className="w-10 pt-1.5 text-right text-label tabular-nums text-muted-foreground">
              {row.time}
            </Text>
            <View
              className={cn(
                "flex-1 rounded-[10px] border border-l-4 border-border px-2.5 py-1.5",
                row.block,
              )}
            >
              <Text className="text-xs font-semibold leading-4">
                {t(row.title)}
              </Text>
              {row.planned ? (
                <View className="flex-row items-center gap-1">
                  <Sparkles size={11} className="text-primary-text" />
                  <Text className="text-label text-primary-text">
                    {t("Zenflow picked this time")}
                  </Text>
                </View>
              ) : (
                <Text
                  className={cn(
                    "text-label",
                    sessionTypeTextClass(row.type),
                  )}
                >
                  {t(row.meta)}
                </Text>
              )}
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}
