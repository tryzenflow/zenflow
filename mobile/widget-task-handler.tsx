import { MonthAgendaWidget } from "@/components/widget/month-agenda-widget";
import { readWidgetSnapshot } from "@/lib/widget-storage";
import type { WidgetTaskHandlerProps } from "react-native-android-widget";

export async function widgetTaskHandler(props: WidgetTaskHandlerProps) {
  if (
    props.widgetAction !== "WIDGET_ADDED" &&
    props.widgetAction !== "WIDGET_UPDATE" &&
    props.widgetAction !== "WIDGET_RESIZED"
  ) return;

  const snapshot = await readWidgetSnapshot();
  if (props.widgetInfo.widgetName !== "NextUpMedium") return;
  props.renderWidget(<MonthAgendaWidget snapshot={snapshot} compact width={props.widgetInfo.width} />);
}
