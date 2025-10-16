import ViewLayout from "../components/layout/view-layout";
import { TaskView } from "../components/tasks/task-view";

export default function TasksViewPage() {
  return (
    <ViewLayout
      renderBody={(body) => (
        <TaskView
          deleteSchedule={body.deleteSchedule}
          openEditTaskDialog={body.openEditTaskDialog}
          schedules={body.schedules}
          selectedDate={body.selectedDate}
        />
      )}
    />
  );
}
