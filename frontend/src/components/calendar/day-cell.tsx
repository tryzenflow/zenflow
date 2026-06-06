import { TIME_GRANULARITY } from "@/utils/constants";
import { cn } from "@/lib/utils";
import { useDroppable } from "@dnd-kit/core";

interface DayCellProps {
  quarter: number;
  hour: number;
  id: string;
}

export function Cell({ quarter, hour, id }: DayCellProps) {
  const { isOver, setNodeRef } = useDroppable({
    id,
  });

  return (
    <div
      key={quarter}
      ref={setNodeRef}
      className={cn(
        "absolute w-full transition-colors",
        isOver && "bg-brand-lime/25",
      )}
      style={{
        top: `calc(var(--week-cells-height) / 4 * ${quarter})`,
        height: "calc(var(--week-cells-height) / 4)",
      }}
      title={`${hour}:${String(quarter * TIME_GRANULARITY).padStart(2, "0")}`}
    />
  );
}
