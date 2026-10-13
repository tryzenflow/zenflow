import { describe, expect, it } from 'vitest';
import { calendarDate, monthCalendar } from '../widget-calendar';
import type { WidgetSnapshot } from '../widget-snapshot';

const snapshot: WidgetSnapshot = {
  generatedAt: '2026-10-14T00:00:00Z',
  tz: 'Asia/Ho_Chi_Minh',
  language: 'vi',
  events: [],
  calendarEvents: [
    { id: 'one', title: 'Một', start: '2026-10-13T18:00:00Z', end: '2026-10-13T19:00:00Z', type: 'TASK', location: null },
    { id: 'two', title: 'Hai', start: '2026-10-13T17:00:00Z', end: '2026-10-13T18:00:00Z', type: 'TASK', location: null },
  ],
};

describe('month widget calendar', () => {
  it('uses the account timezone for today and event days', () => {
    expect(calendarDate('2026-10-13T18:00:00Z', snapshot.tz)).toBe('2026-10-14');
    const calendar = monthCalendar(snapshot, undefined, Date.parse('2026-10-13T18:00:00Z'));
    expect(calendar.selected).toBe('2026-10-14');
    expect(calendar.events.map((event) => event.id)).toEqual(['two', 'one']);
  });

  it('builds a Monday-first month and colors Sundays', () => {
    const calendar = monthCalendar(snapshot, '2026-10-18', Date.parse('2026-10-14T00:00:00Z'));
    expect(calendar.days.slice(0, 4)).toEqual([null, null, null, { day: 1, date: '2026-10-01', isToday: false, isSunday: false }]);
    expect(calendar.days.find((day) => day?.date === '2026-10-18')?.isSunday).toBe(true);
    expect(calendar.days.length % 7).toBe(0);
  });

  it('resets a prior-month selection when the month changes', () => {
    expect(monthCalendar(snapshot, '2026-09-30', Date.parse('2026-10-14T00:00:00Z')).selected).toBe('2026-10-14');
  });
});
