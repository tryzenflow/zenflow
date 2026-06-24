import {
  PREFERENCE_MATRIX_LENGTH,
  PREFERENCE_SLOTS_PER_DAY,
} from "@zenflow/shared";
import { buildRationale } from "./rationale";
import { preferenceIndex } from "./slot";

/**
 * Coverage for the PURE Phase-2 rationale builder. It turns a user's signed
 * 56-cell matrix + a placement instant into a transparency payload, returning
 * null whenever the placement wasn't preference-favoured (cold-start / neutral /
 * disliked slot) so the FE shows no toast.
 */

const TZ = "UTC";
const BLOCKS = PREFERENCE_SLOTS_PER_DAY; // 8

function zeroMatrix(): number[] {
  return new Array<number>(PREFERENCE_MATRIX_LENGTH).fill(0);
}

/** A UTC instant whose (day,bucket) cell index is known, via preferenceIndex.
 * `block` is the 3-hour bucket index (0…7). */
function instantForCell(day: number, block: number): Date {
  // Find a date whose ISO weekday is `day+1` (1=Mon) at the bucket's start hour.
  // 2026-06-15 is a Monday (ISO weekday 1).
  const mondayUtc = Date.UTC(2026, 5, 15); // June 15 2026, Monday 00:00
  const minutes = block * 180; // 3-hour buckets: each bucket = 180 minutes
  const dt = new Date(mondayUtc + day * 86_400_000 + minutes * 60_000);
  return dt;
}

describe("buildRationale", () => {
  it("returns null for a null placement", () => {
    expect(buildRationale(zeroMatrix(), null, TZ)).toBeNull();
  });

  it("returns null for a cold-start (all-zero) matrix", () => {
    const at = instantForCell(0, 3); // Monday 09:00 (bucket 3)
    expect(buildRationale(zeroMatrix(), at, TZ)).toBeNull();
  });

  it("returns null for a wrong-length matrix", () => {
    const at = instantForCell(0, 3);
    expect(buildRationale([1, 2, 3], at, TZ)).toBeNull();
  });

  it("returns null when the placed cell is neutral or disliked", () => {
    const m = zeroMatrix();
    const at = instantForCell(0, 3); // Monday 09:00 (bucket 3)
    const idx = preferenceIndex(at, TZ);
    m[idx] = -3; // disliked
    expect(buildRationale(m, at, TZ)).toBeNull();
  });

  it("builds a rationale for a preference-favoured slot", () => {
    const m = zeroMatrix();
    const at = instantForCell(0, 3); // Monday 09:00 (bucket 3)
    const idx = preferenceIndex(at, TZ);
    m[idx] = 5;
    const r = buildRationale(m, at, TZ);
    expect(r).not.toBeNull();
    expect(r!.summary).toContain("Monday");
    expect(r!.preferredWindow).toBeTruthy();
    expect(r!.topCells?.length).toBeGreaterThan(0);
    expect(r!.topCells?.[0].score).toBe(5);
  });

  it("widens the preferred window across a contiguous positive run", () => {
    const m = zeroMatrix();
    const day = 0;
    const at = instantForCell(day, 3); // Monday 09:00 (bucket 3)
    const base = day * BLOCKS;
    // A run of positive cells spanning buckets 2..5 around bucket 3.
    m[base + 2] = 2;
    m[base + 3] = 5;
    m[base + 4] = 3;
    m[base + 5] = 1;
    const r = buildRationale(m, at, TZ)!;
    // bucket 2 → 06:00 (6*60=360 min); exclusive end bucket 6 → 18:00 (18*60=1080 min).
    expect(r.preferredWindow).toEqual({
      startMin: 2 * 180, // 360 min = 06:00
      endMin: 6 * 180, // 1080 min = 18:00
    });
  });
});
