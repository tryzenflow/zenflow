import { CalendarGrid } from "../components/calendar/grid";
import ViewLayout from "../components/layout/view-layout";
import { TaskView } from "../components/tasks/task-view";

export default function HomePage() {
  return (
    <ViewLayout
      renderBody={(body) => {
        switch (body.currentView) {
          case "Day view":
            return (
              <CalendarGrid
                deleteSchedule={body.deleteSchedule}
                openEditTaskDialog={body.openEditTaskDialog}
                schedules={body.schedules}
                selectedDate={body.selectedDate}
              />
            );
          case "Task view":
            return (
              <TaskView
                tasks={body.tasks}
                setTasks={body.setTasks}
                deleteSchedule={body.deleteSchedule}
                openEditTaskDialog={body.openEditTaskDialog}
                loading={body.loading}
                setLoading={body.setLoading}
                selectedDate={body.selectedDate}
                setSelectedDate={body.setSelectedDate}
              />
            );
          default:
            return null;
        }
      }}
    />
  );
}
