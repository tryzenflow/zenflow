import { Text } from "@/components/ui/text";
import { TimePickerInline } from "@/components/ui/time-picker";
import { hhmmToMinutes } from "@zenflow/core";
import { format } from "date-fns";
import { View } from "react-native";
import { InlineDateField } from "./inline-date-field";

const pad = (n: number) => String(n).padStart(2, "0");
const minutesToHHMM = (m: number) =>
  `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

/**
 * Date + start-time + end-time picker for the fixed session types
 * (`ASSIGNMENT` / `EXAM` / `LECTURE` / `DND`). The form carries `date`
 * (`YYYY-MM-DD`), `startTime` / `endTime` (`HH:mm`); the submit handler
 * derives `durationMinutes` and the concrete `scheduledStartTime`.
 */
export function FixedTimeField({
  date,
  startTime,
  endTime,
  onChangeDate,
  onChangeStart,
  onChangeEnd,
  tz,
  disabled,
}: {
  date: string | undefined;
  startTime: string | undefined;
  endTime: string | undefined;
  onChangeDate: (ymd: string) => void;
  onChangeStart: (hhmm: string) => void;
  onChangeEnd: (hhmm: string) => void;
  tz: string;
  disabled?: boolean;
}) {
  const dateValue = date ? new Date(`${date}T00:00:00`) : undefined;
  const startMin = startTime ? hhmmToMinutes(startTime) : 9 * 60;
  const endMin = endTime ? hhmmToMinutes(endTime) : 10 * 60;

  return (
    <View className="gap-3">
      <InlineDateField
        value={dateValue}
        onChange={(d) => onChangeDate(format(d, "yyyy-MM-dd"))}
        tz={tz}
        disabled={disabled}
        unboundedFuture
      />
      <View className="flex-row gap-3">
        <View className="flex-1">
          <Text className="mb-1.5 text-[12px] font-medium text-muted-foreground">
            Starts
          </Text>
          <TimePickerInline
            value={startMin}
            onChange={(m) => onChangeStart(minutesToHHMM(m))}
            disabled={disabled}
          />
        </View>
        <View className="flex-1">
          <Text className="mb-1.5 text-[12px] font-medium text-muted-foreground">
            Ends
          </Text>
          <TimePickerInline
            value={endMin}
            onChange={(m) => onChangeEnd(minutesToHHMM(m))}
            disabled={disabled}
          />
        </View>
      </View>
    </View>
  );
}
