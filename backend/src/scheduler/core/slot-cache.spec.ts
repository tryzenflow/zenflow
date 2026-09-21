import { toZonedTime } from "date-fns-tz";
import { localDateStr, localMinutesOfDay } from "./slot";

const ZONES = [
  "UTC",
  "America/New_York",
  "Europe/Paris",
  "Asia/Kolkata", // +05:30
  "Asia/Kathmandu", // +05:45
  "Australia/Lord_Howe", // 30-min DST
  "Asia/Ho_Chi_Minh",
];

function uncached(date: Date, tz: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

describe("slot formatter caches", () => {
  const start = Date.UTC(2025, 0, 1);
  const instants: Date[] = [];
  // every 15 min across DST transitions (Mar/Apr/Oct/Nov) and a few days
  for (const base of [start, Date.UTC(2025, 2, 8), Date.UTC(2025, 9, 25)]) {
    for (let i = 0; i < 4 * 24 * 10; i++)
      instants.push(new Date(base + i * 15 * 60_000));
  }

  it("localDateStr matches a fresh formatter (cold and warm)", () => {
    for (let pass = 0; pass < 2; pass++)
      for (const tz of ZONES)
        for (const d of instants)
          expect(localDateStr(d, tz)).toBe(uncached(d, tz));
  });

  it("localMinutesOfDay matches date-fns-tz wall clock", () => {
    for (const tz of ZONES)
      for (const d of instants) {
        const l = toZonedTime(d, tz);
        expect(localMinutesOfDay(d, tz)).toBe(
          l.getHours() * 60 + l.getMinutes(),
        );
      }
  });

  it("still throws on an invalid timezone", () => {
    expect(() => localDateStr(new Date(0), "Not/AZone")).toThrow(RangeError);
  });
});
