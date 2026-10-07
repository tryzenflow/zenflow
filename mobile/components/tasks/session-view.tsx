import { useLanguage } from "@/hooks/use-language";
import { format, t } from "@/lib/i18n";
import {
  Bell,
  CalendarClock,
  Clock,
  MapPin,
  Repeat,
  Tag,
  type LucideIcon,
} from "@/components/Icons";
import { localizedReminderLabel } from "@/components/tasks/form/reminder-field";
import { Text } from "@/components/ui/text";
import { useToast } from "@/components/ui/toast";
import { loadGeistWebviewFontDataUri } from "@/lib/geist-webview-font";
import {
  HEIGHT_MESSAGE,
  LINK_TAP_SCRIPT,
  handleNoteLinkMessage,
  noteColors,
  noteFont,
  noteTypographyCss,
} from "@/lib/note-html";
import { useColorScheme } from "@/lib/useColorScheme";
import {
  fromRrule,
  zonedDate,
} from "@zenflow/core";
import type { Session } from "@zenflow/shared";
import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

const WEEKDAYS: Record<string, string> = {
  MO: "Mon",
  TU: "Tue",
  WE: "Wed",
  TH: "Thu",
  FR: "Fri",
  SA: "Sat",
  SU: "Sun",
};

/** The live (possibly unsaved) values the view shows over the loaded session. */
export interface SessionViewValues {
  title: string;
  note?: string;
  location?: string;
  tags: string[];
  reminders?: number[];
}

function typeLabel(type: Session["type"]): string {
  switch (type) {
    case "TASK":
      return t("Task");
    case "ASSIGNMENT":
      return t("Assignment");
    case "EXAM":
      return t("Exam");
    case "LECTURE":
      return t("Lecture");
    default:
      return t("Do not disturb");
  }
}

function repeatLabel(rrule: string | null): string | null {
  const state = fromRrule(rrule);
  if (state.freq === "NONE") return null;
  const base =
    state.freq === "DAILY"
      ? t("Every day")
      : state.byday.length > 0
        ? state.byday.map((d) => t(WEEKDAYS[d] ?? d)).join(", ")
        : t("Every week");
  return state.until
    ? `${base} · ${t("until {date}", { date: state.until })}`
    : base;
}

function Property({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon;
  label: string;
  children: string;
}) {
  return (
    <View className="flex-row items-start gap-3">
      <View className="w-[104px] flex-row items-center gap-2 pt-px">
        <Icon size={15} className="text-muted-foreground" />
        <Text className="text-[13px] text-muted-foreground">{label}</Text>
      </View>
      <Text className="flex-1 text-[14px] leading-5">{children}</Text>
    </View>
  );
}

/**
 * Read-only "page" for a session — the default when a session is opened. A
 * big title, a Notion-style property list, then the note rendered as HTML.
 */
export function SessionView({
  task,
  values,
  tz,
}: {
  task: Session;
  values: SessionViewValues;
  tz: string;
}) {
  useLanguage();
  const when = useMemo(() => {
    if (!task.scheduledStartTime) return null;
    const start = zonedDate(task.scheduledStartTime, tz);
    const end = new Date(start.getTime() + task.durationMinutes * 60_000);
    return `${format(start, "EEE, MMM d")} · ${format(start, "HH:mm")} – ${format(end, "HH:mm")}`;
  }, [task.scheduledStartTime, task.durationMinutes, tz]);
  const deadline =
    task.type === "TASK" && task.deadline
      ? format(zonedDate(task.deadline, tz), "EEE, MMM d · HH:mm")
      : null;
  const repeat = repeatLabel(task.rrule);
  const reminders = values.reminders ?? [];
  const note = values.note ?? "";

  return (
    <View className="gap-5">
      <View className="gap-2">
        <View className="self-start rounded-full bg-muted px-2.5 py-1">
          <Text className="text-[12px] font-semibold text-muted-foreground">
            {typeLabel(task.type)}
          </Text>
        </View>
        <Text className="text-[26px] font-bold leading-8 tracking-tight">
          {values.title}
        </Text>
      </View>

      <View className="gap-3.5">
        {when && (
          <Property icon={Clock} label={t("When")}>
            {when}
          </Property>
        )}
        {deadline && (
          <Property icon={CalendarClock} label={t("Deadline")}>
            {deadline}
          </Property>
        )}
        {!!values.location && (
          <Property icon={MapPin} label={t("Location")}>
            {values.location}
          </Property>
        )}
        {repeat && (
          <Property icon={Repeat} label={t("Repeat")}>
            {repeat}
          </Property>
        )}
        {reminders.length > 0 && (
          <Property icon={Bell} label={t("Reminder")}>
            {reminders.map((m) => localizedReminderLabel(m)).join(", ")}
          </Property>
        )}
        {values.tags.length > 0 && (
          <Property icon={Tag} label={t("Tags")}>
            {values.tags.map((tag) => `#${tag}`).join("  ")}
          </Property>
        )}
      </View>

      <View className="h-px bg-border" />

      {note.trim() ? (
        <NoteHtml html={note} />
      ) : (
        <Text className="text-[14px] text-muted-foreground">
          {t("No notes")}
        </Text>
      )}
    </View>
  );
}

function NoteHtml({ html }: { html: string }) {
  const { isDarkColorScheme } = useColorScheme();
  const { toast } = useToast();
  const [height, setHeight] = useState(40);
  const [fontDataUri, setFontDataUri] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadGeistWebviewFontDataUri()
      .then((uri) => {
        if (!cancelled) setFontDataUri(uri);
      })
      .catch(() => {
        // falls back to the system sans-serif
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const source = useMemo(() => {
    const { bg, fg } = noteColors(isDarkColorScheme);
    const { fontFace, family } = noteFont(fontDataUri);
    return {
      html: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1"><style>${fontFace} html, body { margin: 0; padding: 0; background: ${bg}; } body { color: ${fg}; font-family: ${family}; font-size: 16px; line-height: 1.55; word-wrap: break-word; } ${noteTypographyCss("body", isDarkColorScheme)}</style></head><body><div id="note">${html}</div></body></html>`,
    };
  }, [html, isDarkColorScheme, fontDataUri]);

  const injected = `${LINK_TAP_SCRIPT}
    (function() {
      function post() {
        var el = document.getElementById('note');
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: ${JSON.stringify(HEIGHT_MESSAGE)},
          height: Math.ceil(el.getBoundingClientRect().height),
        }));
      }
      post();
      window.addEventListener('load', post);
      document.querySelectorAll('img, video').forEach(function(m) {
        m.addEventListener('load', post);
        m.addEventListener('loadedmetadata', post);
      });
      if (window.ResizeObserver) new ResizeObserver(post).observe(document.getElementById('note'));
    })();
    true;
  `;

  function onMessage(event: WebViewMessageEvent) {
    const raw = event.nativeEvent.data;
    if (handleNoteLinkMessage(raw, toast)) return;
    try {
      const data = JSON.parse(raw) as { type?: string; height?: number };
      if (data.type === HEIGHT_MESSAGE && typeof data.height === "number") {
        setHeight(Math.max(24, data.height));
      }
    } catch {
      // not ours
    }
  }

  return (
    <WebView
      originWhitelist={["*"]}
      source={source}
      style={{ height, backgroundColor: "transparent" }}
      scrollEnabled={false}
      injectedJavaScript={injected}
      onMessage={onMessage}
      // Links are routed through `handleNoteLinkMessage`; never navigate in-place.
      onShouldStartLoadWithRequest={(req) => req.url === "about:blank"}
    />
  );
}
