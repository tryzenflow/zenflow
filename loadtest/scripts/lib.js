// Shared helpers: OTP login via MailHog, deterministic seed layout, date maths.
// Variant-agnostic: talks only to the public HTTP API + MailHog.
import http from "k6/http";
import { sleep } from "k6";

export const BASE = __ENV.BASE; // e.g. http://localhost:5641/api/v1
export const MAIL = __ENV.MAIL; // e.g. http://localhost:8541
export const TZ = __ENV.TZ_NAME || "Asia/Ho_Chi_Minh";
export const TZ_OFFSET_MIN = 7 * 60; // Asia/Ho_Chi_Minh has no DST; keep in sync with TZ
// Per-VU private jar: setup() logins would otherwise leak their cookie into the VU jar and override our explicit Cookie header.
export const VU_JAR = new http.CookieJar();
export const JSON_H = { "Content-Type": "application/json" };

export function emailFor(level, i) {
  return `lt-${level}-${i}@example.com`;
}

function mailsFor(email) {
  const r = http.get(`${MAIL}/api/v2/search?kind=to&query=${encodeURIComponent(email)}`, { tags: { name: "mail" } });
  return r.json("items") || [];
}

// Wait for a mail newer than the `before` count, then take the newest by Created.
function otpFromMail(email, before) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const items = mailsFor(email);
    if (items.length > before) {
      items.sort((a, b) => (a.Created < b.Created ? 1 : -1));
      const body = items[0].Content.Body.replace(/=\r?\n/g, "");
      const m = body.match(/>\s*(\d{6})\s*</);
      if (m) return m[1];
    }
    sleep(0.2);
  }
  throw new Error("no new OTP mail for " + email);
}

/** Full OTP login; returns the raw Cookie header string. */
export function login(email) {
  const before = mailsFor(email).length;
  const rq = http.post(`${BASE}/auth/otp/request`, JSON.stringify({ email }), { headers: JSON_H, jar: new http.CookieJar(), tags: { name: "setup_otp_request" } });
  if (rq.status !== 200) throw new Error(`otp/request ${rq.status} ${rq.body}`);
  const otp = otpFromMail(email, before);
  const vr = http.post(`${BASE}/auth/otp/verify`, JSON.stringify({ email, otp }), {
    headers: { ...JSON_H, "X-Timezone": TZ },
    jar: new http.CookieJar(),
    tags: { name: "setup_otp_verify" },
  });
  if (vr.status !== 200) throw new Error(`otp/verify ${vr.status} ${vr.body}`);
  return Object.entries(vr.cookies).map(([k, v]) => `${k}=${v[0].value}`).join("; ");
}

export function headers(cookie) {
  return { ...JSON_H, Cookie: cookie };
}

/** UTC midnight (as epoch ms) of the *local* calendar day `dayOffset` days from now. */
export function localDayStartMs(dayOffset, nowMs = Date.now()) {
  const local = nowMs + TZ_OFFSET_MIN * 60000;
  const d = new Date(local);
  const startLocal = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + dayOffset);
  return startLocal - TZ_OFFSET_MIN * 60000;
}

export const iso = (ms) => new Date(ms).toISOString();

/** Local weekday (0=Sun..6=Sat) of the local calendar day `dayOffset` days from now. */
export function localDow(dayOffset, nowMs) {
  return new Date(localDayStartMs(dayOffset, nowMs) + TZ_OFFSET_MIN * 60000).getUTCDay();
}
const DOW = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const WEEKDAYS = "MO,TU,WE,TH,FR";

/**
 * Fixed-load levels (per week): light ~8, medium ~25, heavy ~60 fixed sessions/occurrences.
 * Realistic mix, identical for every variant, in disjoint time bands so fixed blocks never overlap:
 *   - LECTURE timetable = weekly RRULE series (virtual series, CLAUDE.md invariant 4): one rrule per
 *     time slot, BYDAY weekdays (or a subset)
 *   - EXAM one-offs at 16:45-18:45 (120 min)
 *   - ASSIGNMENT one-offs (60 min) from 19:00, 20:15, 21:30 (the fixed "work block"; ASSIGNMENT is a fixed type)
 * Returns { posts: [...CreateSessionDto bodies], perWeek } for the next `horizonDays` days.
 */
export const LEVELS = {
  light: {
    lectures: [{ h: 9, m: 0, dur: 60, by: "MO,WE,FR" }, { h: 14, m: 0, dur: 90, by: "TU,TH" }], // 5/wk
    exam: (d, dow) => d % 7 === 3 && dow >= 1 && dow <= 5, // ~1/wk
    assignSlots: (d, dow) => (d % 7 === 2 || d % 7 === 5 ? [0] : []), // 2/wk
  },
  medium: {
    lectures: [{ h: 8, m: 0, dur: 60, by: WEEKDAYS }, { h: 10, m: 0, dur: 60, by: WEEKDAYS }, { h: 13, m: 0, dur: 60, by: WEEKDAYS }], // 15/wk
    exam: (d, dow) => dow >= 1 && dow <= 5 && [1, 3, 5].includes(dow), // 3/wk
    assignSlots: () => [0], // 7/wk
  },
  heavy: {
    lectures: [[7, 0], [8, 15], [9, 30], [10, 45], [13, 0], [14, 15], [15, 30]].map(([h, m]) => ({ h, m, dur: 60, by: WEEKDAYS })), // 35/wk
    exam: (d, dow) => dow >= 1 && dow <= 5, // 5/wk
    assignSlots: () => [0, 1, 2], // 21/wk
  },
};
export const LEVEL_NAMES = ["light", "medium", "heavy"];
const ASSIGN_STARTS = [19 * 60, 19 * 60 + 75, 19 * 60 + 150];

export function fixedPlan(level, nowMs, horizonDays = 62) {
  const cfg = LEVELS[level];
  const posts = [];
  const rr = (by) => `FREQ=WEEKLY;BYDAY=${by}`;
  // recurring lecture series: anchor on the first matching weekday from tomorrow
  for (const L of cfg.lectures) {
    const days = L.by.split(",");
    for (let d = 1; d <= 7; d++) {
      if (days.includes(DOW[localDow(d, nowMs)])) {
        posts.push({ type: "LECTURE", title: `lecture ${L.h}:${L.m}`, durationMinutes: L.dur, scheduledStartTime: iso(localDayStartMs(d, nowMs) + (L.h * 60 + L.m) * 60000), rrule: rr(L.by), reminders: [] });
        break;
      }
    }
  }
  for (let d = 1; d <= horizonDays; d++) {
    const dow = localDow(d, nowMs);
    if (cfg.exam(d, dow)) posts.push({ type: "EXAM", title: `exam d${d}`, durationMinutes: 120, scheduledStartTime: iso(localDayStartMs(d, nowMs) + (16 * 60 + 45) * 60000), reminders: [] });
    for (const s of cfg.assignSlots(d, dow)) posts.push({ type: "ASSIGNMENT", title: `assignment d${d}.${s}`, durationMinutes: 60, scheduledStartTime: iso(localDayStartMs(d, nowMs) + ASSIGN_STARTS[s] * 60000), reminders: [] });
  }
  return posts;
}
