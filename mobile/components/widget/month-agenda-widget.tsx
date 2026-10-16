'use no memo';

import vietnamese from '@/lib/i18n-vi';
import { monthCalendar, widgetEventColor, widgetEventHref, widgetEventTime, widgetMonthHref, widgetNewTaskHref } from '@/lib/widget-calendar';
import type { WidgetSnapshot } from '@/lib/widget-snapshot';
import { FlexWidget, ListWidget, TextWidget } from 'react-native-android-widget';

const colors = {
  background: '#00000000',
  text: '#F7F5F6',
  muted: '#C2BEC9',
  sunday: '#F36972',
  divider: '#3A3740',
  addBg: '#2A2730',
} as const;

export function MonthAgendaWidget({ snapshot, compact = false, width = 400, height = 130 }: {
  snapshot: WidgetSnapshot | null;
  compact?: boolean;
  width?: number;
  height?: number;
}) {
  const language = snapshot?.language ?? 'vi';
  const calendar = monthCalendar(snapshot);
  const [year, month] = calendar.month.split('-').map(Number);
  const [, , selectedDay] = calendar.selected.split('-').map(Number);
  const monthLabel = language === 'vi'
    ? selectedDay + ' TH' + month
    : new Intl.DateTimeFormat('en-US', { month: 'short' }).format(new Date(Date.UTC(year, month - 1))) + ' ' + selectedDay;
  const weekdays = language === 'vi' ? ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'] : ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const empty = !snapshot
    ? language === 'vi' ? vietnamese['Sign in to see your schedule'] : 'Sign in to see your schedule'
    : language === 'vi' ? vietnamese['Nothing scheduled'] : 'Nothing scheduled';

  // Sized for exactly 3 items (~34dp per item including separator). Additional tasks scroll.
  const listHeight = compact ? 106 : 112;

  return (
    <FlexWidget
      style={{ width: 'match_parent', height: 'match_parent', backgroundColor: colors.background, padding: compact ? 8 : 12, flexDirection: 'row' }}
      accessibilityLabel={language === 'vi' ? vietnamese['Month calendar'] : 'Month calendar'}
    >
      {/* ── Left: mini calendar (straight grid, no dots, top-aligned) ── */}
      <FlexWidget style={{ width: 168, marginRight: compact ? 10 : 12 }} clickAction="OPEN_URI" clickActionData={{ uri: widgetMonthHref() }}>
        <FlexWidget style={{ flexDirection: 'row', height: 26, alignItems: 'center', marginBottom: compact ? 4 : 6 }}>
          {weekdays.map((name, index) => (
            <FlexWidget key={index} style={{ width: 24, height: 26, alignItems: 'center', justifyContent: 'center' }}>
              <TextWidget text={name} style={{ color: index === 6 ? colors.sunday : colors.muted, fontSize: 12, fontFamily: 'Geist-Medium' }} />
            </FlexWidget>
          ))}
        </FlexWidget>
        {Array.from({ length: calendar.days.length / 7 }, (_, row) => (
          <FlexWidget key={row} style={{ flexDirection: 'row' }}>
            {calendar.days.slice(row * 7, row * 7 + 7).map((day, column) => (
              <FlexWidget
                key={column}
                style={{
                  width: 24,
                  height: compact ? 26 : 28,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 8,
                  ...(day?.date === calendar.selected ? { backgroundColor: colors.text } : {}),
                }}
                accessibilityLabel={day ? day.date : undefined}
              >
                {day && (
                  <TextWidget
                    text={String(day.day)}
                    style={{
                      color: day.date === calendar.selected ? '#171721' : day.isSunday ? colors.sunday : colors.text,
                      fontSize: 13,
                      fontFamily: day.date === calendar.selected ? 'Geist-SemiBold' : 'Geist-Medium',
                    }}
                  />
                )}
              </FlexWidget>
            ))}
          </FlexWidget>
        ))}
      </FlexWidget>

      {/* ── Right: today header (horizontal with weekdays) + divider + scrollable event list ── */}
      <FlexWidget style={{ width: Math.max(100, width - (compact ? 194 : 202)) }}>
        {/* Header row — strictly aligned with weekdays height (26) */}
        <FlexWidget style={{ width: 'match_parent', height: 26, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: compact ? 4 : 6 }}>
          <TextWidget text={monthLabel} style={{ color: colors.text, fontSize: compact ? 19 : 21, fontFamily: 'Geist-SemiBold' }} />
          <FlexWidget
            style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: colors.addBg, alignItems: 'center', justifyContent: 'center' }}
            clickAction="OPEN_URI"
            clickActionData={{ uri: widgetNewTaskHref(calendar.selected, snapshot?.tz ?? 'UTC') }}
            accessibilityLabel={language === 'vi' ? vietnamese['Add session'] : 'Add session'}
          >
            <TextWidget text="+" style={{ color: colors.text, fontSize: 20, fontFamily: 'Geist' }} />
          </FlexWidget>
        </FlexWidget>

        {/* Thin divider line below header */}
        <FlexWidget style={{ width: 'match_parent', height: 1, backgroundColor: colors.divider, marginBottom: compact ? 4 : 6 }} />

        {/* Empty state */}
        {calendar.events.length === 0 && (
          <FlexWidget style={{ width: 'match_parent', height: listHeight, justifyContent: 'center', alignItems: 'center' }}>
            <TextWidget text={empty} style={{ color: colors.muted, fontSize: 12, fontFamily: 'Geist' }} />
          </FlexWidget>
        )}

        {/* Event list — single line (accent bar + time + title) with divider, scrollable */}
        {calendar.events.length > 0 && (
          <ListWidget style={{ width: 'match_parent', height: listHeight }}>
            {calendar.events.map((event) => (
              <FlexWidget
                key={event.id}
                style={{ width: 'match_parent', paddingTop: compact ? 3 : 4, paddingBottom: compact ? 3 : 4 }}
                clickAction="OPEN_URI"
                clickActionData={{ uri: widgetEventHref(event.id) }}
                accessibilityLabel={event.title}
              >
                <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center' }}>
                  {/* Coloured accent bar */}
                  <FlexWidget style={{ width: 4, height: 18, borderRadius: 2, backgroundColor: widgetEventColor(event.type), marginRight: 8 }} />
                  {/* Time in bold */}
                  <TextWidget
                    text={widgetEventTime(event, snapshot?.tz ?? 'UTC', language)}
                    style={{ color: colors.text, fontSize: 13, fontFamily: 'Geist-SemiBold', marginRight: 8 }}
                  />
                  {/* Title */}
                  <FlexWidget style={{ flex: 1 }}>
                    <TextWidget
                      text={event.title}
                      style={{ color: colors.text, fontSize: 13, fontFamily: 'Geist', width: 'match_parent' }}
                      maxLines={1}
                      truncate="END"
                    />
                  </FlexWidget>
                </FlexWidget>
                {/* Thin divider line below item */}
                <FlexWidget style={{ width: 'match_parent', height: 1, backgroundColor: colors.divider, marginTop: compact ? 4 : 5 }} />
              </FlexWidget>
            ))}
          </ListWidget>
        )}
      </FlexWidget>
    </FlexWidget>
  );
}
