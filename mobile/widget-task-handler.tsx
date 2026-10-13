import { MonthAgendaWidget } from "@/components/widget/month-agenda-widget";
import { NextUpWidget } from "@/components/widget/next-up-widget";
import { readWidgetCalendarDate, readWidgetSnapshot, writeWidgetCalendarDate } from "@/lib/widget-storage";
import type { WidgetTaskHandlerProps } from "react-native-android-widget";

export async function widgetTaskHandler(props: WidgetTaskHandlerProps) {
  if (props.widgetAction === "WIDGET_CLICK" && props.clickAction === "SELECT_CALENDAR_DAY") {
    const date = props.clickActionData?.date;
    if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      await writeWidgetCalendarDate(date);
      props.renderWidget(<MonthAgendaWidget snapshot={await readWidgetSnapshot()} selectedDate={date} />);
    }
    return;
  }
  if (
    props.widgetAction !== "WIDGET_ADDED" &&
    props.widgetAction !== "WIDGET_UPDATE" &&
    props.widgetAction !== "WIDGET_RESIZED"
  ) return;

  const snapshot = await readWidgetSnapshot();
  if (props.widgetInfo.widgetName === "MonthAgenda") {
    props.renderWidget(<MonthAgendaWidget snapshot={snapshot} selectedDate={await readWidgetCalendarDate()} />);
    return;
  }
  const size = props.widgetInfo.widgetName === "NextUpMedium" ? "medium" : "small";
  props.renderWidget(<NextUpWidget snapshot={snapshot} size={size} />);
}
