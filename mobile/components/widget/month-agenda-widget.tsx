'use no memo';

import vietnamese from '@/lib/i18n-vi';
import { monthCalendar, widgetEventHref, widgetEventTime, widgetMonthHref, widgetNewTaskHref } from '@/lib/widget-calendar';
import type { WidgetSnapshot } from '@/lib/widget-snapshot';
import { FlexWidget, TextWidget } from 'react-native-android-widget';

const colors = {
  background: '#00000000',
  text: '#F7F5F6',
  muted: '#C2BEC9',
  sunday: '#F36972',
  divider: '#8A8790',
  blue: '#27B9F3',
} as const;

export function MonthAgendaWidget({ snapshot, compact = false, width = 400 }: {
  snapshot: WidgetSnapshot | null;
  compact?: boolean;
  width?: number;
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

  return (
    <FlexWidget
      style={{ width: 'match_parent', height: 'match_parent', backgroundColor: colors.background, padding: compact ? 8 : 12, flexDirection: 'row' }}
      accessibilityLabel={language === 'vi' ? vietnamese['Month calendar'] : 'Month calendar'}
    >
      <FlexWidget style={{ width: 168, marginRight: 10, justifyContent: 'center' }} clickAction="OPEN_URI" clickActionData={{ uri: widgetMonthHref() }}>
        <FlexWidget style={{ flexDirection: 'row', marginBottom: compact ? 2 : 5 }}>
          {weekdays.map((name, index) => (
            <FlexWidget key={index} style={{ width: 24, height: compact ? 21 : 24, alignItems: 'center', justifyContent: 'center' }}>
              <TextWidget text={name} style={{ color: index === 6 ? colors.sunday : colors.muted, fontSize: 12, fontFamily: 'Geist-Medium' }} />
            </FlexWidget>
          ))}
        </FlexWidget>
        {Array.from({ length: calendar.days.length / 7 }, (_, row) => (
          <FlexWidget key={row} style={{ flexDirection: 'row' }}>
            {calendar.days.slice(row * 7, row * 7 + 7).map((day, column) => (
              <FlexWidget
                key={column}
                style={{ width: 24, height: compact ? 28 : 30, alignItems: 'center', justifyContent: 'center', borderRadius: 8, ...(day?.date === calendar.selected ? { backgroundColor: colors.text } : {}) }}
                accessibilityLabel={day ? day.date : undefined}
              >
                {day && <TextWidget text={String(day.day)} style={{ color: day.date === calendar.selected ? '#171721' : day.isSunday ? colors.sunday : colors.text, fontSize: 13, fontFamily: day.date === calendar.selected ? 'Geist-SemiBold' : 'Geist-Medium' }} />}
              </FlexWidget>
            ))}
          </FlexWidget>
        ))}
      </FlexWidget>
      <FlexWidget style={{ width: Math.max(100, width - (compact ? 194 : 202)), justifyContent: 'center' }}>
        <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: compact ? 8 : 12 }}>
          <TextWidget text={monthLabel} style={{ color: colors.text, fontSize: compact ? 19 : 21, fontFamily: 'Geist-SemiBold' }} />
          <FlexWidget
            style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: '#171721', alignItems: 'center', justifyContent: 'center' }}
            clickAction="OPEN_URI"
            clickActionData={{ uri: widgetNewTaskHref(calendar.selected, snapshot?.tz ?? 'UTC') }}
            accessibilityLabel={language === 'vi' ? vietnamese['Add session'] : 'Add session'}
          >
            <TextWidget text="+" style={{ color: colors.text, fontSize: 27, fontFamily: 'Geist' }} />
          </FlexWidget>
        </FlexWidget>
        {calendar.events.length === 0 && <TextWidget text={empty} style={{ color: colors.muted, fontSize: 12, fontFamily: 'Geist' }} />}
        {calendar.events.slice(0, compact ? 3 : 4).map((event, index) => (
          <FlexWidget key={event.id} style={{ marginBottom: compact ? 7 : 9 }}>
            <FlexWidget style={{ flexDirection: 'row', alignItems: 'center' }} clickAction="OPEN_URI" clickActionData={{ uri: widgetEventHref(event.id) }} accessibilityLabel={event.title}>
              <FlexWidget style={{ width: 4, height: 24, borderRadius: 3, backgroundColor: colors.blue, marginRight: 6 }} />
              <TextWidget text={widgetEventTime(event, snapshot?.tz ?? 'UTC', language)} style={{ color: colors.text, fontSize: 12, fontFamily: 'Geist-SemiBold', marginRight: 6 }} />
              <FlexWidget style={{ flex: 1 }}><TextWidget text={event.title} style={{ color: colors.text, fontSize: 12, fontFamily: 'Geist', width: 'match_parent' }} maxLines={1} truncate="END" /></FlexWidget>
            </FlexWidget>
            {index < Math.min(calendar.events.length, compact ? 3 : 4) - 1 && <FlexWidget style={{ height: 1, backgroundColor: colors.divider, marginTop: compact ? 7 : 9 }} />}
          </FlexWidget>
        ))}
        {calendar.events.length > (compact ? 3 : 4) && <TextWidget text={'+' + (calendar.events.length - (compact ? 3 : 4))} style={{ color: colors.muted, fontSize: 11, fontFamily: 'Geist' }} />}
      </FlexWidget>
    </FlexWidget>
  );
}
