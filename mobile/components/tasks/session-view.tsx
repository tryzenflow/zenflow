import { MediaViewer } from "@/components/tasks/media-viewer";
import { useOffline } from "@/hooks/use-offline";
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
import { SessionTypeBadge } from "@/components/calendar/session-type-badge";
import { isSessionPastDeadline } from "@/lib/overdue";
import { localizedReminderLabel } from "@/components/tasks/form/reminder-field";
import { Text } from "@/components/ui/text";
import { useToast } from "@/components/ui/toast";
import { getBaseURL } from "@/lib/api-client";
import { parseFileIdFromHref, resolveNoteFileUrls } from "@/lib/file-link";
import { formatBytes } from "@/lib/file-size";
import { fileSizesFor } from "@/lib/file-sizes";
import { loadGeistWebviewFontDataUri } from "@/lib/geist-webview-font";
import { type LinkPreview, fetchLinkPreview } from "@/lib/link-preview";
import {
  HEIGHT_MESSAGE,
  LINK_CARD_SCRIPT,
  LINK_TAP_SCRIPT,
  handleNoteLinkMessage,
  noteColors,
  noteFont,
  noteLinkCardCss,
  noteTypographyCss,
} from "@/lib/note-html";
import {
  type OpenMedia,
  mediaPlayerScript,
  isFileUrl,
  noteMediaCss,
  parseOpenMediaMessage,
} from "@/lib/note-media";
import { NoteSkeleton } from "@/components/tasks/note-skeleton";
import { DURATION, timeTo, useReducedMotion } from "@/lib/motion";
import { useColorScheme } from "@/lib/useColorScheme";
import { fromRrule, zonedDate } from "@zenflow/core";
import type { Session } from "@zenflow/shared";
import { type ReactNode, memo, useEffect, useMemo, useState } from "react";
import { Linking, Pressable, View } from "react-native";
import Animated, {
  FadeOut,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
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

/**
 * Read-only "page" for a session — the default when a session is opened. A
 * big title, a Notion-style property list, then the note rendered as HTML.
 */
type SessionViewProps = {
  task: Session;
  values: SessionViewValues;
  tz: string;
};

function SessionViewImpl({ task, values, tz }: SessionViewProps) {
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
  const overdue =
    task.type === "TASK" &&
    !!task.deadline &&
    (isSessionPastDeadline(task) ||
      new Date(task.deadline).getTime() < Date.now());
  const repeat = repeatLabel(task.rrule);
  const reminders = values.reminders ?? [];
  const note = values.note ?? "";

  return (
    <View className="gap-5">
      <View className="gap-2">
        <SessionTypeBadge type={task.type} size="lg" />
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
        {!!values.location && (
          <Property icon={MapPin} label={t("Location")} oneLine>
            <LocationValue location={values.location} />
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
            <TagChips tags={values.tags} />
          </Property>
        )}
      </View>

      <View className="h-px bg-border" />

      {note.trim() ? (
        <NoteHtml html={resolveNoteFileUrls(note, getBaseURL())} />
      ) : (
        <Text className="text-[14px] text-muted-foreground">
          {t("No notes")}
        </Text>
      )}
    </View>
  );
}

/**
 * The edit screen passes `form.watch()`, a fresh object every render; compare
 * field by field so the (WebView-backed) page only re-renders on a real change.
 */
export const SessionView = memo(SessionViewImpl, (a, b) => {
  if (a.task !== b.task || a.tz !== b.tz) return false;
  const keys = new Set([...Object.keys(a.values), ...Object.keys(b.values)]);
  for (const key of keys) {
    if (
      (a.values as unknown as Record<string, unknown>)[key] !==
      (b.values as unknown as Record<string, unknown>)[key]
    ) {
      return false;
    }
  }
  return true;
});

function NoteHtml({ html }: { html: string }) {
  const { isDarkColorScheme } = useColorScheme();
  const { toast } = useToast();
  const offline = useOffline();
  const [viewing, setViewing] = useState<OpenMedia | null>(null);
  const [height, setHeight] = useState(40);
  // The WebView paints late and then resizes to the note; hold it invisible
  // behind a skeleton until its first height arrives, then fade it in.
  const [ready, setReady] = useState(false);
  const fade = useSharedValue(0);
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

  // Link-only paragraphs become preview cards; fetch each target's Open Graph
  // metadata (title, description, cover image) and rebuild the page with it.
  // Until a fetch settles the card is a skeleton of the final shape.
  const [previews, setPreviews] = useState<Record<string, LinkPreview>>({});
  const [settled, setSettled] = useState<Record<string, true>>({});
  const previewUrls = useMemo(
    () =>
      Array.from(
        new Set(
          Array.from(
            html.matchAll(
              /<p[^>]*>\s*<a [^>]*href="([^"]+)"[^>]*>[^<]*<\/a>\s*<\/p>/gi,
            ),
            (m) => m[1].replace(/&amp;/g, "&"),
          ).filter((u) => /^https?:\/\//i.test(u) && !isFileUrl(u)),
        ),
      ),
    [html],
  );
  const pendingUrls = useMemo(
    () => previewUrls.filter((u) => !settled[u]),
    [previewUrls, settled],
  );
  useEffect(() => {
    let cancelled = false;
    for (const url of previewUrls) {
      fetchLinkPreview(url).then((p) => {
        if (cancelled) return;
        if (p) setPreviews((prev) => ({ ...prev, [url]: p }));
        setSettled((prev) => ({ ...prev, [url]: true }));
      });
    }
    return () => {
      cancelled = true;
    };
  }, [previewUrls]);

  // Document cards show the file's size. The metadata endpoint needs the
  // session, which the WebView doesn't have, so it is fetched here (once per
  // file, then kept) and handed to the page by link.
  const [fileSizes, setFileSizes] = useState<Record<string, string>>({});
  const fileLinks = useMemo(() => {
    const byHref: Record<string, string> = {};
    for (const m of html.matchAll(/<a [^>]*href="([^"]+)"/gi)) {
      const href = m[1].replace(/&amp;/g, "&");
      const id = isFileUrl(href)
        ? parseFileIdFromHref(href, getBaseURL())
        : null;
      if (id) byHref[href] = id;
    }
    return byHref;
  }, [html]);
  useEffect(() => {
    const ids = Array.from(new Set(Object.values(fileLinks)));
    if (ids.length === 0) return;
    let cancelled = false;
    void fileSizesFor(ids, !offline).then((found) => {
      if (cancelled) return;
      const next: Record<string, string> = {};
      for (const [href, id] of Object.entries(fileLinks)) {
        if (found[id] !== undefined) next[href] = formatBytes(found[id]);
      }
      setFileSizes((prev) =>
        JSON.stringify(prev) === JSON.stringify(next) ? prev : next,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [fileLinks, offline]);

  const reduceMotion = useReducedMotion();
  const webViewStyle = useAnimatedStyle(() => ({ opacity: fade.value }));
  function markReady() {
    if (ready) return;
    setReady(true);
    fade.value = timeTo(1, reduceMotion);
  }
  // Never leave the skeleton up if the page never reports a height.
  useEffect(() => {
    const timer = setTimeout(markReady, 2500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const source = useMemo(() => {
    const { fg } = noteColors(isDarkColorScheme);
    const { fontFace, family } = noteFont(fontDataUri);
    return {
      html: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1"><style>${fontFace} html, body { margin: 0; padding: 0; background: transparent; } #note { display: flow-root; padding-bottom: 6px; } body { color: ${fg}; font-family: ${family}; font-size: 16px; line-height: 1.55; word-wrap: break-word; } ${noteTypographyCss("body", isDarkColorScheme)} ${noteLinkCardCss("body", isDarkColorScheme, reduceMotion)} ${noteMediaCss("body", isDarkColorScheme, noteColors(isDarkColorScheme))}</style></head><body><div id="note">${html}</div><script>window.ZF_PREVIEWS = ${JSON.stringify(previews).replace(/</g, "\\u003c")}; window.ZF_PENDING = ${JSON.stringify(pendingUrls).replace(/</g, "\u003c")}; window.ZF_FILE_SIZES = ${JSON.stringify(fileSizes).replace(/</g, "\u003c")};</script></body></html>`,
    };
  }, [
    html,
    isDarkColorScheme,
    fontDataUri,
    previews,
    pendingUrls,
    fileSizes,
    reduceMotion,
  ]);
  // The page is rebuilt when connectivity flips, so media swaps to / from placeholders.
  const sourceKey = offline ? "offline" : "online";

  const injected = `${LINK_TAP_SCRIPT}
    ${mediaPlayerScript({
      offline,
      labels: {
        offline: t("Offline"),
        failed: t("Couldn't load. Tap to retry."),
      },
    })}
    ${LINK_CARD_SCRIPT}
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
      document.querySelectorAll('img, video, audio').forEach(function(m) {
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
    const media = parseOpenMediaMessage(raw);
    if (media) {
      setViewing(media);
      return;
    }
    try {
      const data = JSON.parse(raw) as { type?: string; height?: number };
      if (data.type === HEIGHT_MESSAGE && typeof data.height === "number") {
        setHeight(Math.max(24, data.height));
        markReady();
      }
    } catch {
      // not ours
    }
  }

  return (
    <View className="gap-2">
      <View style={{ minHeight: ready ? undefined : 124 }}>
        {!ready && (
          <Animated.View
            exiting={reduceMotion ? undefined : FadeOut.duration(DURATION.fast)}
            className="absolute inset-x-0 top-1"
            pointerEvents="none"
          >
            <NoteSkeleton />
          </Animated.View>
        )}
        <Animated.View
          style={webViewStyle}
          layout={
            reduceMotion ? undefined : LinearTransition.duration(DURATION.base)
          }
        >
          <WebView
            key={sourceKey}
            originWhitelist={["*"]}
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction
            source={source}
            style={{ height, backgroundColor: "transparent" }}
            scrollEnabled={false}
            // iOS needs the view itself non-opaque for the transparent page to show the sheet behind.
            opaque={false}
            injectedJavaScript={injected}
            onMessage={onMessage}
            onError={markReady}
            // Links are routed through `handleNoteLinkMessage`; never navigate in-place.
            onShouldStartLoadWithRequest={(req) => req.url === "about:blank"}
          />
        </Animated.View>
      </View>
      <MediaViewer media={viewing} onClose={() => setViewing(null)} />
    </View>
  );
}
