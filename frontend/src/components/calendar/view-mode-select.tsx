import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { ViewMode } from "@zenflow/shared";

export function ViewModeSelect({
  value,
  onChange,
}: {
  value: ViewMode;
  onChange: (v: ViewMode) => void;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as ViewMode)}>
      <SelectTrigger className="w-24 sm:w-[140px]">
        <span className="capitalize">{value}</span>
      </SelectTrigger>
      <SelectContent>
        <SelectItem className="flex flex-1 w-full justify-between" value="day">
          <span>Day</span>
          <span className="text-muted-foreground font-mono">D</span>
        </SelectItem>
        <SelectItem className="flex w-full justify-between" value="week">
          <span>Week</span>
          <span className="text-muted-foreground font-mono">W</span>
        </SelectItem>
        <SelectItem className="flex w-full justify-between" value="month">
          <span>Month</span>
          <span className="text-muted-foreground font-mono">M</span>
        </SelectItem>
      </SelectContent>
    </Select>
  );
}
