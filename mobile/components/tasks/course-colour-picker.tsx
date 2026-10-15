import { useLanguage } from "@/hooks/use-language";
import { useCourseColourStore } from "@/hooks/use-course-colours";
import { t } from "@/lib/i18n";
import { Text } from "@/components/ui/text";
import { COURSE_SWATCHES, courseSwatchIndex } from "@zenflow/core";
import { cn } from "@/lib/utils";
import { Pressable, View } from "react-native";

/** Swatch picker for a course's colour, shown on the session detail. */
export function CourseColourPicker({ courseKey }: { courseKey: string }) {
  useLanguage();
  const overrides = useCourseColourStore((s) => s.overrides);
  const setColour = useCourseColourStore((s) => s.setColour);
  const resetColour = useCourseColourStore((s) => s.resetColour);
  const selected = courseSwatchIndex(courseKey, overrides);
  const custom = overrides.has(courseKey);

  return (
    <View className="gap-2">
      <View className="flex-row flex-wrap items-center gap-x-1 gap-y-1">
        {COURSE_SWATCHES.map((swatch, index) => {
          const isSelected = index === selected;
          return (
            <Pressable
              key={swatch.base}
              testID={`course-colour.${index}`}
              accessibilityRole="radio"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={t("Colour {n}", { n: index + 1 })}
              onPress={() => void setColour(courseKey, index)}
              hitSlop={6}
              className="h-11 w-11 items-center justify-center"
            >
              <View
                className={cn(
                  "h-8 w-8 rounded-full",
                  isSelected && "border-2 border-foreground",
                )}
                style={{ backgroundColor: swatch.base }}
              />
            </Pressable>
          );
        })}
      </View>
      {custom && (
        <Pressable
          accessibilityRole="button"
          onPress={() => void resetColour(courseKey)}
          className="self-start py-1"
        >
          <Text className="text-[13px] font-semibold text-muted-foreground">
            {t("Reset to automatic")}
          </Text>
        </Pressable>
      )}
    </View>
  );
}
