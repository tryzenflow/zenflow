import { ChevronDown, ChevronUp } from "@/components/Icons";
import { Text } from "@/components/ui/text";
import { interpret, termTrends, type Trend } from "@/lib/student-insights";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type {
  StudentMarkDto,
  StudentProfileDto,
  StudentTermMarksDto,
} from "@zenflow/shared";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

const MAX_GPA = 4;

export function fixed(value: number | null, digits = 2): string {
  return value === null ? "" : value.toFixed(digits);
}

/** "HK02" -> "2" */
function termNumber(termId: string): string {
  return termId.replace(/^HK0?/, "");
}

const LETTER_TONE: Record<string, string> = {
  A: "bg-success/50",
  B: "bg-brand-yellow/20",
  C: "bg-brand-orange/20",
};

function LetterBadge({ letter }: { letter: string }) {
  return (
    <View
      className={cn(
        "h-7 w-7 items-center justify-center rounded-lg",
        LETTER_TONE[letter] ?? "bg-destructive/15",
      )}
    >
      <Text className="text-[13px] font-bold">{letter}</Text>
    </View>
  );
}

const TREND_MARK: Record<Trend, string> = { up: "↑", down: "↓", flat: "=" };

function MarkRow({ mark }: { mark: StudentMarkDto }) {
  return (
    <View className="flex-row items-center gap-3 py-2">
      <View className="min-w-0 flex-1">
        <Text
          className={cn(
            "text-[14px]",
            mark.noCredit && "text-muted-foreground",
          )}
          numberOfLines={2}
        >
          {mark.curriculumName}
        </Text>
        <Text className="mt-0.5 text-[12px] text-muted-foreground">
          {mark.noCredit ? t("No credit") : `${mark.credits} ${t("credits")}`}
        </Text>
      </View>
      <Text
        numberOfLines={1}
        className={cn(
          "w-12 text-right text-[15px] font-semibold tabular-nums",
          mark.noCredit && "text-muted-foreground",
        )}
      >
        {fixed(mark.score10, 1)}
      </Text>
      {mark.letter ? (
        <LetterBadge letter={mark.letter} />
      ) : (
        <View className="w-7" />
      )}
    </View>
  );
}

function TermCard({
  term,
  trend,
  open,
  onToggle,
}: {
  term: StudentTermMarksDto;
  trend: { trend: Trend; delta: number } | undefined;
  open: boolean;
  onToggle: () => void;
}) {
  const Chevron = open ? ChevronUp : ChevronDown;
  return (
    <View className="mb-3 overflow-hidden rounded-2xl border border-border bg-card">
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        className="flex-row items-center gap-3 px-4 py-3"
      >
        <View className="min-w-0 flex-1">
          <Text className="text-[15px] font-semibold">
            {t("Semester")} {termNumber(term.termId)} {term.yearStudy}
          </Text>
          {term.creditsEarned !== null ? (
            <Text className="mt-0.5 text-[12px] text-muted-foreground">
              {term.creditsEarned} {t("credits")}
            </Text>
          ) : null}
        </View>
        {term.gpa4 !== null ? (
          <View className="items-end">
            <Text className="text-[17px] font-bold tracking-tight">
              {fixed(term.gpa4)}
            </Text>
            {trend ? (
              <Text
                className={cn(
                  "text-[12px] font-semibold",
                  trend.trend === "up" && "text-session-done-ink",
                  trend.trend === "down" && "text-destructive",
                  trend.trend === "flat" && "text-muted-foreground",
                )}
              >
                {TREND_MARK[trend.trend]} {Math.abs(trend.delta).toFixed(2)}
              </Text>
            ) : null}
          </View>
        ) : null}
        <Chevron size={16} className="text-muted-foreground" />
      </Pressable>
      {open ? (
        <View className="border-t border-border px-4 py-1">
          {term.marks.map((mark) => (
            <MarkRow
              key={`${mark.curriculumId}${mark.curriculumName}`}
              mark={mark}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** Bars of term GPA, oldest to newest; the latest is solid. */
function GpaBars({ terms }: { terms: readonly StudentTermMarksDto[] }) {
  const series = terms
    .filter((x) => x.gpa4 !== null)
    .slice(0, 8)
    .reverse();
  if (series.length < 2) return null;
  return (
    <View
      accessible
      accessibilityLabel={t("GPA by semester")}
      className="mt-3 h-10 flex-row items-end gap-1.5"
    >
      {series.map((term, i) => (
        <View
          key={`${term.yearStudy}${term.termId}`}
          className={cn(
            "flex-1 rounded-sm bg-primary",
            i < series.length - 1 && "opacity-40",
          )}
          style={{
            height: `${Math.max(8, ((term.gpa4 ?? 0) / MAX_GPA) * 100)}%`,
          }}
        />
      ))}
    </View>
  );
}

function Summary({
  profile,
  terms,
}: {
  profile: StudentProfileDto;
  terms: readonly StudentTermMarksDto[];
}) {
  const lines = interpret(profile.gpa4, terms);
  return (
    <View className="mx-5 mb-4 rounded-2xl bg-primary/10 p-4">
      <View className="flex-row items-end gap-4">
        <View>
          <Text className="text-[12px] text-muted-foreground">{t("GPA")}</Text>
          <Text className="text-[34px] font-bold leading-[38px] tracking-tight">
            {fixed(profile.gpa4)}
            <Text className="text-[15px] font-medium text-muted-foreground">
              {" "}
              / 4.00
            </Text>
          </Text>
        </View>
        <View className="ml-auto items-end">
          <Text className="text-[17px] font-bold">
            {profile.creditsEarned ?? ""}
          </Text>
          <Text className="text-[12px] text-muted-foreground">
            {t("Credits")}
          </Text>
        </View>
        {profile.ranking ? (
          <View className="items-end">
            <Text className="text-[17px] font-bold">{profile.ranking}</Text>
            <Text className="text-[12px] text-muted-foreground">
              {t("Standing")}
            </Text>
          </View>
        ) : null}
      </View>
      <GpaBars terms={terms} />
      {lines.length > 0 ? (
        <Text className="mt-3 text-[13px] leading-[19px]">
          {lines.join(". ")}
        </Text>
      ) : null}
    </View>
  );
}

export function MarksSheet({
  profile,
  terms,
}: {
  profile: StudentProfileDto;
  terms: StudentTermMarksDto[];
}) {
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const trends = termTrends(terms);
  return (
    <ScrollView style={{ maxHeight: 560 }} showsVerticalScrollIndicator={false}>
      <Summary profile={profile} terms={terms} />
      <View className="px-5 pb-4">
        {terms.map((term, i) => {
          const key = `${term.yearStudy}|${term.termId}`;
          // Newest term opens by default; a tap flips any term from that default.
          const open = (i === 0) !== closed.has(key);
          return (
            <TermCard
              key={key}
              term={term}
              trend={trends.get(key)}
              open={open}
              onToggle={() =>
                setClosed((prev) => {
                  const next = new Set(prev);
                  if (!next.delete(key)) next.add(key);
                  return next;
                })
              }
            />
          );
        })}
      </View>
    </ScrollView>
  );
}
