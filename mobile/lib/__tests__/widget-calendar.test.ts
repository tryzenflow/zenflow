import { describe, expect, it } from 'vitest';
import { calendarDate, monthCalendar, widgetEventHref, widgetMonthHref, widgetNewTaskHref } from '../widget-calendar';
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
    const calendar = monthCalendar(snapshot, Date.parse('2026-10-13T18:00:00Z'));
    expect(calendar.selected).toBe('2026-10-14');
    expect(calendar.events.map((event) => event.id)).toEqual(['two', 'one']);
  });

  it('includes upcoming tasks when the month response is empty and deduplicates overlaps', () => {
    const future = { id: 'future', title: 'Task', start: '2026-10-14T07:00:00Z', end: '2026-10-14T08:00:00Z', type: 'TASK' as const, location: null };
    const calendar = monthCalendar({ ...snapshot, calendarEvents: [future], events: [future] }, Date.parse('2026-10-14T03:00:00Z'));
    expect(calendar.events.map((event) => event.id)).toEqual(['future']);
    expect(monthCalendar({ ...snapshot, calendarEvents: [], events: [future] }, Date.parse('2026-10-14T03:00:00Z')).events).toEqual([future]);
  });

  it('hides Do not disturb', () => {
    const today = Date.parse('2026-10-14T03:00:00Z');
    const events: WidgetSnapshot['events'] = [
      { id: 'task', title: 'Task', start: '2026-10-14T07:00:00Z', end: '2026-10-14T08:00:00Z', type: 'TASK', location: null },
      { id: 'exam', title: 'Exam', start: '2026-10-14T08:00:00Z', end: '2026-10-14T09:00:00Z', type: 'EXAM', location: null },
      { id: 'dnd', title: 'Busy', start: '2026-10-14T09:00:00Z', end: '2026-10-14T10:00:00Z', type: 'DND', location: null },
    ];
    expect(monthCalendar({ ...snapshot, calendarEvents: events }, today).events.map((event) => event.id)).toEqual(['task', 'exam']);
  });

  it('opens the tapped session details, including a virtual occurrence id', () => {
    expect(widgetEventHref('series::2026-10-14T07:00:00Z')).toBe('zenflow://task/series%3A%3A2026-10-14T07%3A00%3A00Z/edit');
  });

  it('builds a Monday-first month and colors Sundays', () => {
    const calendar = monthCalendar(snapshot, Date.parse('2026-10-14T00:00:00Z'));
    expect(calendar.days.slice(0, 4)).toEqual([null, null, null, { day: 1, date: '2026-10-01', isToday: false, isSunday: false }]);
    expect(calendar.days.find((day) => day?.date === '2026-10-18')?.isSunday).toBe(true);
    expect(calendar.days.length % 7).toBe(0);
  });

  it('always shows the account current day, including after month rollover', () => {
    expect(monthCalendar(snapshot, Date.parse('2026-10-31T18:00:00Z')).selected).toBe('2026-11-01');
  });

  it('opens Month view and seeds a task deadline on the displayed day', () => {
    expect(widgetMonthHref()).toBe('zenflow://month');
    const href = widgetNewTaskHref('2026-10-14', snapshot.tz);
    const url = new URL(href);
    expect(`${url.protocol}//${url.host}${url.pathname}`).toBe('zenflow://task/new');
    expect(url.searchParams.get('start')).toBe('2026-10-14T16:45:00.000Z');
    expect(url.searchParams.get('deadline')).toBe('2026-10-14T16:45:00.000Z');
  });

  it('uses the supplied timezone across a different UTC date', () => {
    const url = new URL(widgetNewTaskHref('2026-10-14', 'America/Los_Angeles'));
    expect(url.searchParams.get('deadline')).toBe('2026-10-15T06:45:00.000Z');
  });

  it('shows an empty agenda when signed out', () => {
    expect(monthCalendar(null, Date.parse('2026-10-14T00:00:00Z')).events).toEqual([]);
  });
});
