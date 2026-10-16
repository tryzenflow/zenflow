import "@bacons/text-decoder/install";
// Defines the background check-in task before the app (or a headless run) starts.
import "./lib/daily-checkin-task";
import "expo-router/entry";
import { registerWidgetTaskHandler } from "react-native-android-widget";
import { widgetTaskHandler } from "./widget-task-handler";

registerWidgetTaskHandler(widgetTaskHandler);
