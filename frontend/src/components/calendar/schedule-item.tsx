import { Schedule } from "../../types/schedule";

const focusColorMap = {
  1: {
    bg: "bg-green-100/70 dark:bg-green-900/40",
    text: "text-green-800 dark:text-green-300",
    border: "border-green-500",
    hover: "hover:bg-green-200/70 dark:hover:bg-green-800/40",
  },
  2: {
    bg: "bg-yellow-100/70 dark:bg-yellow-900/40",
    text: "text-yellow-800 dark:text-yellow-300",
    border: "border-yellow-500",
    hover: "hover:bg-yellow-200/70 dark:hover:bg-yellow-800/40",
  },
  3: {
    bg: "bg-red-100/70 dark:bg-red-900/40",
    text: "text-red-800 dark:text-red-300",
    border: "border-red-500",
    hover: "hover:bg-red-200/70 dark:hover:bg-red-800/40",
  },
};

export const ScheduleItem = ({ schedule }: { schedule: Schedule }) => {
  const { task, start, end } = schedule;
  const colors = focusColorMap[task.focusLevel] || focusColorMap[1];

  const startDate = new Date(start);
  const endDate = new Date(end);
  const startHour = startDate.getHours();
  const startMinute = startDate.getMinutes();
  const endHour = endDate.getHours();
  const endMinute = endDate.getMinutes();

  // Calculate position (top) and duration (height) in a grid where 1 hour = 64px
  const startMinutes = startHour * 60 + startMinute;
  const endMinutes = endHour * 60 + endMinute;
  const durationMinutes = endMinutes - startMinutes;

  // 1 minute = 64px / 60 = 1.0667px
  const topPosition = (startMinutes / 60) * 64;
  const height = (durationMinutes / 60) * 64;

  return (
    <div
      className={`absolute w-[95%] rounded-md p-2 text-xs border-l-4 shadow-sm transition-all ${colors.bg} ${colors.text} ${colors.border} ${colors.hover}`}
      style={{
        top: `${topPosition}px`,
        height: `${height}px`,
        minHeight: "2rem", // Minimum height for visibility
        zIndex: 10,
        marginLeft: "1rem",
        overflow: "hidden",
      }}
    >
      <div className="font-semibold">{task.title}</div>
      {durationMinutes > 60 && (
        <div className="text-[10px] opacity-80">
          {startDate.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}{" "}
          -{" "}
          {endDate.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </div>
      )}
    </div>
  );
};
