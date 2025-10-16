import { Schedule } from "../../types/schedule";

export function TaskView({
  selectedDate,
  schedules,
  deleteSchedule,
  openEditTaskDialog,
}: {
  selectedDate: Date;
  schedules: Schedule[];
  deleteSchedule: (taskId: string, date: string, split: number) => void;
  openEditTaskDialog: (taskId: string) => void;
}) {
  return <div>Task view</div>;
}
