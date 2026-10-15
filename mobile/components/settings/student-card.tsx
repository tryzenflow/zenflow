import { getMarks } from "@/api/student";
import { ChevronRight } from "@/components/Icons";
import { fixed, MarksSheet } from "@/components/settings/marks-sheet";
import {
  BottomSheet,
  BottomSheetContent,
  BottomSheetOpenTrigger,
  BottomSheetView,
} from "@/components/ui/bottom-sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { useLanguage } from "@/hooks/use-language";
import { t } from "@/lib/i18n";
import type { StudentProfileDto, StudentTermMarksDto } from "@zenflow/shared";
import { useState } from "react";
import { Pressable, View } from "react-native";

const MAX_GPA = 4;

function initial(fullName: string): string {
  const last = fullName.trim().split(/\s+/).pop() ?? "";
  return last.charAt(0).toUpperCase();
}

function Chip({ label }: { label: string }) {
  return (
    <View className="rounded-full bg-muted px-2.5 py-0.5">
      <Text className="text-[12px] text-muted-foreground">{label}</Text>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-1 rounded-xl bg-muted px-3 py-2">
      <Text className="text-[16px] font-bold tracking-tight" numberOfLines={1}>
        {value}
      </Text>
      <Text className="mt-0.5 text-[12px] text-muted-foreground">{label}</Text>
    </View>
  );
}

/**
 * The DLU student profile under the account row: class, cohort, program and
 * GPA, with the marks one tap away. Hidden until the first profile fetch lands.
 */
export function StudentCard({ profile }: { profile: StudentProfileDto }) {
  useLanguage();
  const [terms, setTerms] = useState<StudentTermMarksDto[] | null>(null);
  const [failed, setFailed] = useState(false);

  async function loadMarks() {
    setFailed(false);
    try {
      setTerms((await getMarks()).terms);
    } catch {
      setFailed(true);
    }
  }

  const chips = [
    profile.className,
    profile.cohort,
    profile.studyProgramName,
  ].filter((x): x is string => Boolean(x));

  return (
    <BottomSheet>
      <BottomSheetOpenTrigger asChild>
        <Pressable
          onPress={loadMarks}
          className="gap-3 border-t border-border px-4 py-3.5"
        >
          <View className="flex-row items-center gap-3">
            <View className="h-11 w-11 items-center justify-center rounded-full bg-primary/15">
              <Text className="text-[18px] font-bold text-primary">
                {initial(profile.fullName)}
              </Text>
            </View>
            <View className="min-w-0 flex-1">
              <Text className="text-[16px] font-semibold" numberOfLines={1}>
                {profile.fullName}
              </Text>
              {profile.studentId ? (
                <Text className="mt-0.5 text-[12px] text-muted-foreground">
                  {profile.studentId}
                </Text>
              ) : null}
            </View>
            <ChevronRight size={18} className="text-muted-foreground" />
          </View>
          {chips.length > 0 ? (
            <View className="flex-row flex-wrap gap-1.5">
              {chips.map((c) => (
                <Chip key={c} label={c} />
              ))}
            </View>
          ) : null}
          {profile.gpa4 !== null ? (
            <View className="gap-2.5">
              <View className="flex-row items-baseline gap-1.5">
                <Text className="text-[28px] font-bold leading-[32px] tracking-tight">
                  {fixed(profile.gpa4)}
                </Text>
                <Text className="text-[13px] text-muted-foreground">
                  / 4.00 {t("GPA")}
                </Text>
              </View>
              <View className="h-1.5 overflow-hidden rounded-full bg-muted">
                <View
                  className="h-full rounded-full bg-primary"
                  style={{
                    width: `${Math.min(100, (profile.gpa4 / MAX_GPA) * 100)}%`,
                  }}
                />
              </View>
              <View className="flex-row gap-2">
                <Stat
                  label={t("Credits")}
                  value={String(profile.creditsEarned ?? "")}
                />
                {profile.ranking ? (
                  <Stat label={t("Standing")} value={profile.ranking} />
                ) : null}
              </View>
            </View>
          ) : null}
        </Pressable>
      </BottomSheetOpenTrigger>
      <BottomSheetContent>
        <BottomSheetView className="px-0" hadHeader={false}>
          <View className="px-5 pb-3">
            <Text className="text-[19px] font-bold tracking-tight">
              {t("Marks")}
            </Text>
          </View>
          {terms ? (
            <MarksSheet profile={profile} terms={terms} />
          ) : failed ? (
            <Pressable onPress={loadMarks} className="px-5 py-2">
              <Text className="text-[14px] text-muted-foreground">
                {t("Couldn't load marks")}
              </Text>
              <Text className="mt-1 text-[14px] font-semibold text-primary">
                {t("Retry")}
              </Text>
            </Pressable>
          ) : (
            <View
              className="gap-3 px-5"
              accessibilityLabel={t("Loading marks")}
            >
              <Skeleton className="h-28 rounded-2xl" />
              <Skeleton className="h-14 rounded-2xl" />
              <Skeleton className="h-14 rounded-2xl" />
            </View>
          )}
        </BottomSheetView>
      </BottomSheetContent>
    </BottomSheet>
  );
}
