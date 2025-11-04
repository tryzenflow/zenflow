import { DayView } from "../components/calendar/day-view";
import { MonthView } from "../components/calendar/month-view";
import { WeekView } from "../components/calendar/week-view";
import { YearView } from "../components/calendar/year-view";
import ViewLayout from "../components/layout/view-layout";
import { TaskView } from "../components/tasks/task-view";

export default function HomePage() {
  return (
    <ViewLayout
      renderBody={(body) => {
        switch (body.currentView) {
          case "Day view":
            return (
              <DayView
                deleteSchedule={body.deleteSchedule}
                updateScheduleTime={body.updateScheduleTime}
                openEditTaskDialog={body.openEditTaskDialog}
                schedules={body.schedules}
                selectedDate={body.selectedDate}
              />
            );
          case "Week view":
            return (
              <WeekView
                setSelectedDate={body.setSelectedDate}
                deleteSchedule={body.deleteSchedule}
                updateScheduleTime={body.updateScheduleTime}
                openEditTaskDialog={body.openEditTaskDialog}
                schedules={body.schedules}
                selectedDate={body.selectedDate}
              />
            );
          case "Month view":
            return <MonthView />;
          case "Year view":
            return <YearView />;
          case "Task view":
            return (
              <TaskView
                taskViewRefetchTrigger={body.taskViewRefetchTrigger}
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
