import { Bell, CalendarClock, Clock, Globe, MapPin, Repeat, Tag, type LucideIcon } from "@/components/Icons";
import { Text } from "@/components/ui/text";
import { useLanguage } from "@/hooks/use-language";
import { format, t } from "@/lib/i18n";
import { isSessionPastDeadline } from "@/lib/overdue";
import { localizedReminderLabel } from "@/components/tasks/composer/reminder-field";
import { fromRrule, zonedDate } from "@zenflow/core";
import type { Session } from "@zenflow/shared";
import { type ReactNode, useMemo, useState } from "react";
import { Linking, Pressable, View } from "react-native";

const WEEKDAYS: Record<string, string> = {
  MO: "Mon",
  TU: "Tue",
  WE: "Wed",
  TH: "Thu",
  FR: "Fri",
  SA: "Sat",
  SU: "Sun",
};

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
    ? `${base}, ${t("until {date}", { date: state.until })}`
    : base;
}

const TAG_MAX_CHARS = 20;
const TAGS_SHOWN = 3;

/** Orange chip like the form's tag pills; long names are trimmed. */
function TagChip({ name }: { name: string }) {
  const short =
    name.length > TAG_MAX_CHARS ? `${name.slice(0, TAG_MAX_CHARS - 1)}…` : name;
  return (
    <View className="rounded-full border border-brand-orange/45 bg-brand-orange/15 px-3 py-1.5">
      <Text className="text-[13px] font-semibold text-brand-orange">
        {short}
      </Text>
    </View>
  );
}

function TagChips({ tags }: { tags: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const extra = tags.length - TAGS_SHOWN;
  const shown = expanded ? tags : tags.slice(0, TAGS_SHOWN);
  return (
    <View className="flex-1 flex-row flex-wrap items-center gap-1.5">
      {shown.map((tag) => (
        <TagChip key={tag} name={tag} />
      ))}
      {extra > 0 && (
        <Pressable
          onPress={() => setExpanded((e) => !e)}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          className="rounded-full border border-border bg-muted px-3 py-1.5 active:opacity-70"
        >
          <Text className="text-[13px] font-semibold text-muted-foreground">
            {expanded ? t("Show less") : t("+{count} more", { count: extra })}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const URL_RE = /^https?:\/\/\S+$/i;

/** A room or building as plain text; a link as tappable, underlined orange text (one line). */
function LocationValue({ location }: { location: string }) {
  const url = location.trim();
  if (!URL_RE.test(url)) {
    return (
      <Text
        className="flex-1 text-[15px] leading-[22px]"
        numberOfLines={1}
        ellipsizeMode="tail"
      >
        {location}
      </Text>
    );
  }
  return (
    <Pressable
      className="min-w-0 flex-1"
      accessibilityRole="link"
      accessibilityLabel={url}
      onPress={() => void Linking.openURL(url).catch(() => {})}
    >
      <Text
        className="text-[15px] leading-[22px] text-primary underline"
        numberOfLines={1}
        ellipsizeMode="middle"
      >
        {url}
      </Text>
    </Pressable>
  );
}

/** One property row: a larger icon in place of the "<icon> <label>" pair (the label stays for screen readers). */
function Property({
  icon: Icon,
  label,
  oneLine,
  children,
}: {
  icon: LucideIcon;
  label: string;
  /** Trim to a single line with an ellipsis (locations, URLs). */
  oneLine?: boolean;
  children: ReactNode;
}) {
  // Plain-text rows are one VoiceOver element reading "Label, value". Rows
  // holding a link or button stay ungrouped so those remain focusable; the
  // icon carries the label there.
  const plain = typeof children === "string";
  return (
    <View
      className="flex-row items-center gap-4"
      accessible={plain}
      accessibilityLabel={plain ? `${label}, ${children}` : undefined}
    >
      <View
        className="w-7 items-center"
        accessible={!plain}
        accessibilityLabel={plain ? undefined : label}
      >
        <Icon size={22} className="text-muted-foreground" />
      </View>
      {typeof children === "string" ? (
        <Text
          className="flex-1 text-[15px] leading-[22px]"
          numberOfLines={oneLine ? 1 : undefined}
          ellipsizeMode="tail"
        >
          {children}
        </Text>
      ) : (
        children
      )}
    </View>
  );
}


/** The session's property rows: when, deadline, location, repeat, reminders and tags. */
export function SessionProperties({ task, tz }: { task: Session; tz: string }) {
  useLanguage();
  const when = useMemo(() => {
    if (!task.scheduledStartTime) return null;
    const start = zonedDate(task.scheduledStartTime, tz);
    const end = new Date(start.getTime() + task.durationMinutes * 60_000);
    return `${format(start, "EEE, MMM d")}, ${format(start, "HH:mm")} – ${format(end, "HH:mm")}`;
  }, [task.scheduledStartTime, task.durationMinutes, tz]);
  const deadline =
    task.type === "TASK" && task.deadline
      ? format(zonedDate(task.deadline, tz), "EEE, MMM d, HH:mm")
      : null;
  const overdue =
    task.type === "TASK" &&
    !!task.deadline &&
    (isSessionPastDeadline(task) ||
      new Date(task.deadline).getTime() < Date.now());
  const repeat = repeatLabel(task.rrule);
  const reminders = task.reminders ?? [];
  const location = task.location ?? "";
  const isLink = URL_RE.test(location.trim());

  return (
      <View className="gap-3.5">
        {when && (
          <Property icon={Clock} label={t("When")}>
            {when}
          </Property>
        )}
        {deadline && (
          <Property icon={CalendarClock} label={t("Deadline")}>
            <Text className="flex-1 text-[15px] leading-[22px]">
              {/* Always label the time; red "Overdue at" once it has passed. */}
              <Text
                className={
                  overdue
                    ? "text-[15px] font-semibold leading-[22px] text-destructive"
                    : "text-[15px] font-semibold leading-[22px] text-muted-foreground"
                }
              >
                {overdue ? t("Overdue at") : t("Due at")}{" "}
              </Text>
              {deadline}
            </Text>
          </Property>
        )}
        {!!location && (
          <Property icon={isLink ? Globe : MapPin} label={t("Location")} oneLine>
            <LocationValue location={location} />
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
        {task.tags.length > 0 && (
          <Property icon={Tag} label={t("Tags")}>
            <TagChips tags={task.tags} />
          </Property>
        )}
      </View>
  );
}
