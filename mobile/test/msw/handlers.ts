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
  http.patch(`${API}/users/me`, () => HttpResponse.json({ data: testUser })),
];
