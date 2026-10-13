'use no memo';

import { nextWidgetEvent, type WidgetSnapshot } from "@/lib/widget-snapshot";
import vietnamese from "@/lib/i18n-vi";
import { FlexWidget, TextWidget } from "react-native-android-widget";

const PALETTE = {
  background: "#FEFCFA",
  ink: "#322B25",
  muted: "#766C62",
  amber: "#D97735",
} as const;

function startLabel(start: string, language: "en" | "vi", timezone: string) {
  try {
    return new Intl.DateTimeFormat(language === "vi" ? "vi-VN" : "en-US", {
      timeZone: timezone,
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(start));
  } catch {
    return "";
  }
}

export function NextUpWidget({
  snapshot,
  size,
}: {
  snapshot: WidgetSnapshot | null;
  size: "small" | "medium";
}) {
  const language = snapshot?.language ?? "vi";
  const next = nextWidgetEvent(snapshot);
  const heading = language === "vi" ? vietnamese["Next up"] : "Next up";
  const empty = snapshot
    ? language === "vi"
      ? vietnamese["Nothing scheduled"]
      : "Nothing scheduled"
    : language === "vi"
      ? vietnamese["Sign in to see your schedule"]
      : "Sign in to see your schedule";
  const time = next?.start
    ? startLabel(next.start, language, snapshot?.tz ?? "UTC")
    : "";

  return (
    <FlexWidget
      style={{
        width: "match_parent",
        height: "match_parent",
        backgroundColor: PALETTE.background,
        borderRadius: 20,
        padding: 16,
        justifyContent: "center",
      }}
      accessibilityLabel={next ? `${heading}: ${next.title}, ${time}` : `${heading}: ${empty}`}
    >
      <TextWidget
        text={heading}
        style={{ color: PALETTE.amber, fontSize: 13, fontFamily: "Geist-Medium" }}
      />
      <TextWidget
        text={next?.title ?? empty}
        style={{
          color: PALETTE.ink,
          fontSize: size === "medium" ? 20 : 17,
          fontFamily: "Geist-SemiBold",
        }}
      />
      {next && (
        <TextWidget
          text={time}
          style={{ color: PALETTE.muted, fontSize: 13, fontFamily: "Geist" }}
        />
      )}
    </FlexWidget>
  );
}
