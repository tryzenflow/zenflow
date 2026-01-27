import { TIME_GRANULARITY } from "@/utils/constants";
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
  const style = {
    opacity: isOver ? 1 : 0.5,
  };

  return (
    <div
      key={quarter}
      ref={setNodeRef}
      className="absolute bg-white w-full"
      style={{
        ...style,
        top: `calc(var(--week-cells-height) / 4 * ${quarter})`,
        height: "calc(var(--week-cells-height) / 4)",
      }}
      title={`${hour}:${String(quarter * TIME_GRANULARITY).padStart(2, "0")}`}
    />
  );
}
