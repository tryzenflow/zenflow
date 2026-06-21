import { readFile } from "node:fs/promises";
import { Logger } from "@nestjs/common";

/**
 * Paired significance testing for the closed-loop A/B (phase-2-evaluation-steps
 * §Step 6, ADR-0001 §5). Unit of analysis = PERSONA (never task): each persona is
 * run under both arms with the SAME seed, so we compare a persona to itself.
 *
 *  - Paired **Wilcoxon signed-rank** on the per-persona MAR delta `(MAR_A − MAR_B)`
 *    — a non-parametric test that does not assume normal deltas (MAR is a bounded
 *    rate). Positive deltas mean Phase-2 (B) lowered MAR (the win direction).
 *  - **Cliff's δ** — a non-parametric effect size in [-1, 1] (how often B beats A).
 *  - **95% bootstrap CI** of the mean delta.
 *  - An OUTER **multi-seed sweep**: repeat the paired test over several population
 *    seeds and report the distribution of the effect — one lucky population is not
 *    evidence (the paired test is across personas WITHIN a population; the sweep is
 *    the orthogonal robustness axis).
 *
 * The stats are PURE + unit-tested (`significance.spec.ts`); only `main()` does
 * I/O (reading the per-arm metric JSON the `sim:eval` step emits).
 */

// ───────────────────────────────── pure stats ──────────────────────────────

/** Standard-normal CDF via the Abramowitz-Stegun erf approximation. */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p =
    d *
    t *
    (0.3193815 +
      t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

export interface WilcoxonResult {
  /** Signed-rank statistic W (sum of positive-delta ranks). */
  w: number;
  /** Number of non-zero pairs used (zero deltas are dropped). */
  n: number;
  /** Normal-approximation z (continuity-corrected). */
  z: number;
  /** Two-sided p-value from the normal approximation. */
  p: number;
}

/**
 * Paired Wilcoxon signed-rank test on a list of deltas `(A − B)`. Zero deltas are
 * dropped (standard Wilcoxon). Ranks are average-ranked over ties. Uses the
 * normal approximation with a continuity correction — fine for the n≈10–50
 * personas per population this sweep runs over.
 */
export function wilcoxonSignedRank(deltas: number[]): WilcoxonResult {
  const nonzero = deltas.filter((d) => d !== 0);
  const n = nonzero.length;
  if (n === 0) return { w: 0, n: 0, z: 0, p: 1 };

  // Rank by absolute value, averaging tied ranks.
  const sorted = nonzero
    .map((d, i) => ({ d, abs: Math.abs(d), i }))
    .sort((a, b) => a.abs - b.abs);
  const ranks = new Array<number>(n);
  for (let i = 0; i < n; ) {
    let j = i;
    while (j < n && sorted[j].abs === sorted[i].abs) j++;
    const avg = (i + 1 + j) / 2; // average of ranks [i+1 … j]
    for (let k = i; k < j; k++) ranks[k] = avg;
    i = j;
  }

  let wPlus = 0;
  let wMinus = 0;
  for (let k = 0; k < n; k++) {
    if (sorted[k].d > 0) wPlus += ranks[k];
    else wMinus += ranks[k];
  }
  const w = wPlus;
  const meanW = (n * (n + 1)) / 4;
  const sdW = Math.sqrt((n * (n + 1) * (2 * n + 1)) / 24);
  // Continuity-corrected z on the smaller tail statistic.
  const wMin = Math.min(wPlus, wMinus);
  const z = sdW > 0 ? (wMin - meanW + 0.5) / sdW : 0;
  const p = sdW > 0 ? 2 * normalCdf(z) : 1;
  return { w, n, z, p: Math.min(1, Math.max(0, p)) };
}

/**
 * Cliff's δ effect size for paired/unpaired samples in [-1, 1]: the probability
 * that a value from `a` exceeds one from `b` minus the reverse. Here `a` = MAR_A,
 * `b` = MAR_B, so a POSITIVE δ means Phase-2 (B) tends to have the lower MAR (the
 * win). Magnitude bands (Romano): |δ|<0.147 negligible, <0.33 small, <0.474
 * medium, else large.
 */
export function cliffsDelta(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  let gt = 0;
  let lt = 0;
  for (const x of a) {
    for (const y of b) {
      if (x > y) gt++;
      else if (x < y) lt++;
    }
  }
  return (gt - lt) / (a.length * b.length);
}

/** Mean of a list. */
function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

/**
 * Percentile bootstrap 95% CI of the mean of `xs` (default 2000 resamples). A
 * tiny deterministic LCG drives resampling so the CI is reproducible without
 * pulling in the persona RNG.
 */
export function bootstrapMeanCI(
  xs: number[],
  resamples = 2000,
  seed = 12345,
): { lo: number; hi: number; mean: number } {
  if (xs.length === 0) return { lo: 0, hi: 0, mean: 0 };
  let s = seed >>> 0;
  const rand = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const means: number[] = [];
  for (let r = 0; r < resamples; r++) {
    let acc = 0;
    for (let i = 0; i < xs.length; i++)
      acc += xs[Math.floor(rand() * xs.length)];
    means.push(acc / xs.length);
  }
  means.sort((p, q) => p - q);
  const lo = means[Math.floor(0.025 * resamples)];
  const hi = means[Math.floor(0.975 * resamples)];
  return { lo, hi, mean: mean(xs) };
}

export interface PairedMarAnalysis {
  personas: number;
  marAMean: number;
  marBMean: number;
  /** Mean of (MAR_A − MAR_B): positive ⇒ Phase-2 lowered MAR. */
  deltaMean: number;
  wilcoxon: WilcoxonResult;
  cliffsDelta: number;
  ci95: { lo: number; hi: number; mean: number };
}

/**
 * Run the full paired analysis over two equal-length, persona-aligned MAR
 * vectors. `marA` and `marB` MUST be paired (same persona at each index).
 */
export function pairedMarAnalysis(
  marA: number[],
  marB: number[],
): PairedMarAnalysis {
  const n = Math.min(marA.length, marB.length);
  const a = marA.slice(0, n);
  const b = marB.slice(0, n);
  const deltas = a.map((x, i) => x - b[i]);
  return {
    personas: n,
    marAMean: mean(a),
    marBMean: mean(b),
    deltaMean: mean(deltas),
    wilcoxon: wilcoxonSignedRank(deltas),
    cliffsDelta: cliffsDelta(a, b),
    ci95: bootstrapMeanCI(deltas),
  };
}

// ──────────────────────────── multi-seed sweep ──────────────────────────────

export interface SeedResult {
  seed: number;
  analysis: PairedMarAnalysis;
}

export interface SweepSummary {
  seeds: number[];
  /** Distribution of the per-seed mean MAR delta (the win, across populations). */
  deltaMeanAcrossSeeds: number;
  deltaMinAcrossSeeds: number;
  deltaMaxAcrossSeeds: number;
  /** Fraction of seeds where the paired test cleared p < 0.05 AND B lowered MAR. */
  fractionSignificantWins: number;
  perSeed: SeedResult[];
}

/** Summarize the outer multi-seed robustness loop over per-seed analyses. */
export function summarizeSweep(results: SeedResult[]): SweepSummary {
  const deltas = results.map((r) => r.analysis.deltaMean);
  const wins = results.filter(
    (r) => r.analysis.wilcoxon.p < 0.05 && r.analysis.deltaMean > 0,
  ).length;
  return {
    seeds: results.map((r) => r.seed),
    deltaMeanAcrossSeeds: mean(deltas),
    deltaMinAcrossSeeds: deltas.length ? Math.min(...deltas) : 0,
    deltaMaxAcrossSeeds: deltas.length ? Math.max(...deltas) : 0,
    fractionSignificantWins: results.length ? wins / results.length : 0,
    perSeed: results,
  };
}

// ───────────────────────────────── I/O wrapper ─────────────────────────────

/**
 * The shape `sim:eval` emits
 * ({ metrics: { perPersona: [{ userId, personaKey, mar }] } }). `personaKey` is
 * the deterministic persona email — the STABLE cross-arm key. `userId` (a random
 * per-run UUID) is the fallback for legacy dumps that predate the key.
 */
export interface MetricsDump {
  metrics?: {
    perPersona?: { userId: string; personaKey?: string; mar: number }[];
  };
  perPersona?: { userId: string; personaKey?: string; mar: number }[];
}

/**
 * Index a dump's per-persona MAR by its STABLE pairing key: the deterministic
 * `personaKey` (persona email) when present, else the legacy `userId`. Keying on
 * `personaKey` is what lets two arms be paired directly — the same persona has
 * the SAME email across arms but a different random `userId` — so the throwaway
 * out-of-band re-key step the eval doc described is no longer needed.
 */
export function perPersonaMar(dump: MetricsDump): Map<string, number> {
  const rows = dump.metrics?.perPersona ?? dump.perPersona ?? [];
  return new Map(rows.map((r) => [r.personaKey || r.userId, r.mar]));
}

/** Pair two arms' per-persona MAR by their stable key, dropping unmatched. */
export function pairByUser(
  a: Map<string, number>,
  b: Map<string, number>,
): { marA: number[]; marB: number[] } {
  const marA: number[] = [];
  const marB: number[] = [];
  for (const [key, va] of a) {
    const vb = b.get(key);
    if (vb !== undefined) {
      marA.push(va);
      marB.push(vb);
    }
  }
  return { marA, marB };
}

/**
 * `sim:significance` entry point. Reads paired per-arm metric JSON (the
 * `sim:eval` dumps for Arm A = identity and Arm B = phase2) and prints the paired
 * analysis. Supports a multi-seed sweep:
 *
 *   node dist/simulation/eval/significance.js \
 *     --a=armA-seed1.json --b=armB-seed1.json
 *   node dist/simulation/eval/significance.js \
 *     --pairs=armA1.json=armB1.json,armA2.json=armB2.json
 *
 * Within a pair the two paths are separated by `=` and pairs by `,` (an `=`
 * rather than `:` so Windows drive-letter paths like `C:\…` parse cleanly). Each
 * `armX.json` is the JSON `sim:eval` wrote for that arm/seed (capture it with
 * `pnpm sim:eval > armA-seed1.json`).
 */
async function main(): Promise<void> {
  const logger = new Logger("sim:significance");
  const argv = process.argv.slice(2);
  const get = (name: string): string | undefined => {
    const pref = `--${name}=`;
    const hit = argv.find((x) => x.startsWith(pref));
    return hit ? hit.slice(pref.length) : undefined;
  };

  const loadMar = async (path: string): Promise<Map<string, number>> =>
    perPersonaMar(JSON.parse(await readFile(path, "utf8")) as MetricsDump);

  const pairsArg = get("pairs");
  const results: SeedResult[] = [];

  if (pairsArg) {
    const pairs = pairsArg.split(",").map((p) => p.split("="));
    let seed = 1;
    for (const [aPath, bPath] of pairs) {
      const a = await loadMar(aPath);
      const b = await loadMar(bPath);
      const { marA, marB } = pairByUser(a, b);
      results.push({ seed: seed++, analysis: pairedMarAnalysis(marA, marB) });
    }
  } else {
    const aPath = get("a");
    const bPath = get("b");
    if (!aPath || !bPath) {
      throw new Error(
        "Provide --a=<armA.json> --b=<armB.json>, or --pairs=a1:b1,a2:b2 for a multi-seed sweep.",
      );
    }
    const a = await loadMar(aPath);
    const b = await loadMar(bPath);
    const { marA, marB } = pairByUser(a, b);
    results.push({ seed: 1, analysis: pairedMarAnalysis(marA, marB) });
  }

  const sweep = summarizeSweep(results);
  for (const r of results) {
    const an = r.analysis;
    logger.log(
      `seed ${r.seed}: n=${an.personas} MAR_A=${an.marAMean.toFixed(3)} ` +
        `MAR_B=${an.marBMean.toFixed(3)} Δ=${an.deltaMean.toFixed(3)} ` +
        `(95% CI [${an.ci95.lo.toFixed(3)}, ${an.ci95.hi.toFixed(3)}]) ` +
        `Wilcoxon p=${an.wilcoxon.p.toFixed(4)} Cliff's δ=${an.cliffsDelta.toFixed(3)}`,
    );
  }
  logger.log(
    `Sweep: mean Δ across ${sweep.seeds.length} seed(s)=${sweep.deltaMeanAcrossSeeds.toFixed(
      3,
    )} [${sweep.deltaMinAcrossSeeds.toFixed(3)}, ${sweep.deltaMaxAcrossSeeds.toFixed(
      3,
    )}], significant wins=${(sweep.fractionSignificantWins * 100).toFixed(0)}%`,
  );
  console.log(JSON.stringify(sweep, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
