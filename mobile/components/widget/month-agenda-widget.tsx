'use no memo';

import vietnamese from '@/lib/i18n-vi';
import { monthCalendar, widgetEventTime } from '@/lib/widget-calendar';
import type { WidgetSnapshot } from '@/lib/widget-snapshot';
import { FlexWidget, TextWidget } from 'react-native-android-widget';

const colors = {
  background: '#201F2C',
  text: '#F7F5F6',
  muted: '#C2BEC9',
  sunday: '#F36972',
  divider: '#55515E',
  blue: '#27B9F3',
  amber: '#F0A663',
  violet: '#A994F7',
} as const;

export function MonthAgendaWidget({ snapshot, selectedDate }: {
  snapshot: WidgetSnapshot | null;
  selectedDate?: string;
}) {
  const language = snapshot?.language ?? 'vi';
  const calendar = monthCalendar(snapshot, selectedDate);
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
      style={{ width: 'match_parent', height: 'match_parent', backgroundColor: colors.background, borderRadius: 22, padding: 12, flexDirection: 'row' }}
      accessibilityLabel={language === 'vi' ? vietnamese['Month calendar'] : 'Month calendar'}
    >
      <FlexWidget style={{ width: 156, marginRight: 10, justifyContent: 'center' }}>
        <FlexWidget style={{ flexDirection: 'row', marginBottom: 5 }}>
          {weekdays.map((name, index) => (
            <FlexWidget key={index} style={{ width: 22, height: 24, alignItems: 'center', justifyContent: 'center' }}>
              <TextWidget text={name} style={{ color: index === 6 ? colors.sunday : colors.muted, fontSize: 11, fontFamily: 'Geist-Medium' }} />
            </FlexWidget>
          ))}
        </FlexWidget>
        {Array.from({ length: calendar.days.length / 7 }, (_, row) => (
          <FlexWidget key={row} style={{ flexDirection: 'row' }}>
            {calendar.days.slice(row * 7, row * 7 + 7).map((day, column) => (
              <FlexWidget
                key={column}
                style={{ width: 22, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 8, ...(day?.date === calendar.selected ? { backgroundColor: colors.text } : {}) }}
                clickAction={day ? 'SELECT_CALENDAR_DAY' : undefined}
                clickActionData={day ? { date: day.date } : undefined}
                accessibilityLabel={day ? day.date : undefined}
              >
                {day && <TextWidget text={String(day.day)} style={{ color: day.date === calendar.selected ? colors.background : day.isSunday ? colors.sunday : colors.text, fontSize: 13, fontFamily: day.date === calendar.selected ? 'Geist-SemiBold' : 'Geist-Medium' }} />}
              </FlexWidget>
            ))}
          </FlexWidget>
        ))}
      </FlexWidget>
      <FlexWidget style={{ flex: 1, justifyContent: 'center' }}>
        <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <TextWidget text={monthLabel} style={{ color: colors.text, fontSize: 21, fontFamily: 'Geist-SemiBold' }} />
          <FlexWidget
            style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: '#171721', alignItems: 'center', justifyContent: 'center' }}
            clickAction="OPEN_URI"
            clickActionData={{ uri: 'zenflow://task/new' }}
            accessibilityLabel={language === 'vi' ? vietnamese['Add session'] : 'Add session'}
          >
            <TextWidget text="+" style={{ color: colors.text, fontSize: 27, fontFamily: 'Geist' }} />
          </FlexWidget>
        </FlexWidget>
        {calendar.events.length === 0 && <TextWidget text={empty} style={{ color: colors.muted, fontSize: 12, fontFamily: 'Geist' }} />}
        {calendar.events.slice(0, 3).map((event, index) => (
          <FlexWidget key={event.id} style={{ marginBottom: 9 }}>
            <FlexWidget style={{ flexDirection: 'row', alignItems: 'center' }} clickAction="OPEN_APP">
              <FlexWidget style={{ width: 4, height: 24, borderRadius: 3, backgroundColor: [colors.blue, colors.amber, colors.violet][index], marginRight: 7 }} />
              <TextWidget text={widgetEventTime(event, snapshot?.tz ?? 'UTC', language)} style={{ color: colors.text, fontSize: 12, fontFamily: 'Geist-SemiBold', marginRight: 7 }} />
              <FlexWidget style={{ flex: 1 }}><TextWidget text={event.title} style={{ color: colors.text, fontSize: 12, fontFamily: 'Geist', width: 'match_parent' }} maxLines={1} truncate="END" /></FlexWidget>
            </FlexWidget>
            {index < Math.min(calendar.events.length, 3) - 1 && <FlexWidget style={{ height: 1, backgroundColor: colors.divider, marginTop: 9 }} />}
          </FlexWidget>
        ))}
        {calendar.events.length > 3 && <TextWidget text={'+' + (calendar.events.length - 3)} style={{ color: colors.muted, fontSize: 11, fontFamily: 'Geist' }} />}
      </FlexWidget>
    </FlexWidget>
  );
}
