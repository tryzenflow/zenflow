import { plannedPersonas } from "./runner";
import { POPULATION, type ArchetypeId } from "./personas/archetypes";

/**
 * `plannedPersonas` builds the ordered (archetype, GLOBAL index) seed list. The
 * Step-6/7 evaluation needs a shrunken-but-balanced population: `--personas` (a
 * flat cap) drops later cohorts, so `--personas-per-cohort` keeps the first N of
 * EACH archetype. Crucially the global `index` (= per-persona seed key) must NOT
 * be renumbered by capping, or a capped run would draw different personas.
 */

const countByCohort = (
  plan: { archetype: ArchetypeId }[],
): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const p of plan) out[p.archetype] = (out[p.archetype] ?? 0) + 1;
  return out;
};

describe("plannedPersonas", () => {
  it("defaults to the full POPULATION in order", () => {
    const plan = plannedPersonas();
    const total = POPULATION.reduce((a, p) => a + p.count, 0);
    expect(plan.length).toBe(total);
    expect(plan.map((p) => p.index)).toEqual(
      Array.from({ length: total }, (_, i) => i),
    );
  });

  it("a flat --personas cap drops later cohorts (the trap)", () => {
    const plan = plannedPersonas(15);
    const counts = countByCohort(plan);
    // POPULATION starts dev:12, night_owl:10 → 15 keeps dev + 3 night_owl only.
    expect(plan.length).toBe(15);
    expect(Object.keys(counts).sort()).toEqual(["dev", "night_owl"]);
    expect(counts.ops).toBeUndefined();
    expect(counts.crammer).toBeUndefined();
  });

  it("--personas-per-cohort keeps EVERY archetype represented", () => {
    const plan = plannedPersonas(undefined, 3);
    const counts = countByCohort(plan);
    expect(Object.keys(counts).sort()).toEqual(
      [...POPULATION.map((p) => p.archetype)].sort(),
    );
    for (const p of POPULATION) expect(counts[p.archetype]).toBe(3);
  });

  it("keeps the GLOBAL index (seed key) stable under a per-cohort cap", () => {
    const full = plannedPersonas();
    const capped = plannedPersonas(undefined, 3);
    // Each capped persona's (archetype, index) must equal one in the full plan —
    // i.e. capping never renumbers a surviving persona's seed key.
    for (const c of capped) {
      expect(full).toContainEqual(c);
    }
    // The first 3 dev indices are exactly 0,1,2 (dev leads POPULATION).
    const devIdx = capped
      .filter((p) => p.archetype === "dev")
      .map((p) => p.index);
    expect(devIdx).toEqual([0, 1, 2]);
  });

  it("clamps a per-cohort cap larger than a cohort to the cohort size", () => {
    const plan = plannedPersonas(undefined, 1000);
    const counts = countByCohort(plan);
    for (const p of POPULATION) expect(counts[p.archetype]).toBe(p.count);
  });
});
