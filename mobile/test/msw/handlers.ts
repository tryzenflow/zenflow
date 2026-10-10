import { http, HttpResponse } from "msw";

export const API = "http://api.test";

export const testUser = {
  id: "u1",
  email: "a@b.co",
  name: "Test User",
  lang: "en",
  timezone: "Asia/Ho_Chi_Minh",
} as const;

/** Happy-path defaults; individual tests override with `server.use(...)`. */
export const handlers = [
  http.post(`${API}/auth/otp/request`, () => HttpResponse.json({ ok: true })),
  http.post(`${API}/auth/otp/verify`, () => HttpResponse.json({ data: testUser })),
  http.post(`${API}/auth/logout`, () => HttpResponse.json({ ok: true })),
  http.get(`${API}/auth/me`, () => HttpResponse.json({ data: testUser })),
  http.get(`${API}/integrations`, () =>
    HttpResponse.json({ data: { integrations: [] } }),
  ),
  http.get(`${API}/sessions/deadline-options`, () =>
    HttpResponse.json({
      data: {
        today: "2026-10-15T16:59:59.000Z",
        tomorrow: "2026-10-16T16:59:59.000Z",
        thisWeek: "2026-10-18T16:59:59.000Z",
        nextWeek: "2026-10-25T16:59:59.000Z",
        thisMonth: "2026-10-31T16:59:59.000Z",
        noRush: "2026-12-31T16:59:59.000Z",
      },
    }),
  ),
  http.get(`${API}/sessions`, () => HttpResponse.json({ data: { sessions: [] } })),
  http.get(`${API}/tags`, () => HttpResponse.json({ data: { tags: [] } })),
  http.patch(`${API}/users/update/basic-info`, () => HttpResponse.json({ data: testUser })),
  http.patch(`${API}/users/me`, () => HttpResponse.json({ data: testUser })),
];
