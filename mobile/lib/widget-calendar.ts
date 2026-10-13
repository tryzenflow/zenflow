import type { WidgetEvent, WidgetSnapshot } from './widget-snapshot';

export interface CalendarDay {
  day: number;
  date: string;
  isToday: boolean;
  isSunday: boolean;
}

function dateParts(instant: string | number, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(instant));
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: read('year'), month: read('month'), day: read('day') };
}

export function calendarDate(instant: string | number, timezone: string): string {
  try {
    const { year, month, day } = dateParts(instant, timezone);
    return [year, month, day].map((value, index) => String(value).padStart(index ? 2 : 4, '0')).join('-');
  } catch {
    return calendarDate(instant, 'UTC');
  }
}

export function monthCalendar(snapshot: WidgetSnapshot | null, selectedDate?: string, now = Date.now()) {
  const timezone = snapshot?.tz || 'UTC';
  const today = calendarDate(now, timezone);
  const month = today.slice(0, 7);
  const selected = selectedDate?.slice(0, 7) === month ? selectedDate : today;
  const [year, monthNumber] = month.split('-').map(Number);
  const firstWeekday = (new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const days: (CalendarDay | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => {
      const day = index + 1;
      const date = month + '-' + String(day).padStart(2, '0');
      return { day, date, isToday: date === today, isSunday: (firstWeekday + index) % 7 === 6 };
    }),
  ];
  while (days.length % 7) days.push(null);
  const events = (snapshot?.calendarEvents ?? snapshot?.events ?? [])
    .filter((event) => calendarDate(event.start, timezone) === selected)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  return { month, selected, today, days, events };
}

export function widgetEventTime(event: WidgetEvent, timezone: string, language: 'en' | 'vi') {
  try {
    return new Intl.DateTimeFormat(language === 'vi' ? 'vi-VN' : 'en-GB', {
      timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(new Date(event.start));
  } catch {
    return '';
  }
}
