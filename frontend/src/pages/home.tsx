import { CalendarLayout } from "@/components/calendar/layout";
import { WithAuth } from "@/components/hoc/with-auth";

export default function HomePage() {
  return (
    <WithAuth>
      <CalendarLayout />
    </WithAuth>
  );
}
