/**
 * App-wide type scale. Readability pass: every size set through a Tailwind
 * class is nudged up by `TYPE_SCALE` and rounded to the nearest half point.
 * NativeWind compiles classes at build time, so a runtime-computed
 * `text-[Npx]` would silently do nothing; the scaled numbers are applied as
 * inline style instead (see `components/ui/text.tsx`). Change the one
 * constant to retune the whole app.
 */
export const TYPE_SCALE = 1.08;

/** Tailwind's named sizes: [font size, line height] in px. */
const NAMED: Record<string, [number, number]> = {
  xs: [12, 16],
  sm: [14, 20],
  base: [16, 24],
  lg: [18, 28],
  xl: [20, 28],
  "2xl": [24, 32],
  "3xl": [30, 36],
  "4xl": [36, 40],
  "5xl": [48, 48],
};

const LEADING: Record<string, number> = {
  none: 1,
  tight: 1.25,
  snug: 1.375,
  normal: 1.5,
  relaxed: 1.625,
  loose: 2,
};

const half = (n: number) => Math.round(n * 2) / 2;

export interface ScaledType {
  fontSize?: number;
  lineHeight?: number;
}

/**
 * Scaled font size / line height for a merged class string, or `{}` when it
 * sets no size. Only unprefixed and `native:` tokens count (`web:`, `lg:` and
 * `dark:` variants do not apply to the native size). Later tokens win, like CSS.
 */
export function scaleType(className?: string): ScaledType {
  if (!className) return {};
  let size: number | undefined;
  let namedLine: number | undefined;
  let leadingPx: number | undefined;
  let leadingMul: number | undefined;

  for (const raw of className.split(/\s+/)) {
    const token = raw.startsWith("native:") ? raw.slice(7) : raw;
    if (token.includes(":")) continue;

    let m = token.match(/^text-\[(\d+(?:\.\d+)?)px\]$/);
    if (m) {
      size = Number(m[1]);
      namedLine = undefined;
      continue;
    }
    m = token.match(/^text-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl)$/);
    if (m) {
      [size, namedLine] = NAMED[m[1]];
      continue;
    }
    m = token.match(/^leading-\[(\d+(?:\.\d+)?)px\]$/);
    if (m) {
      leadingPx = Number(m[1]);
      leadingMul = undefined;
      continue;
    }
    m = token.match(/^leading-\[(\d*\.?\d+)\]$/);
    if (m) {
      leadingMul = Number(m[1]);
      leadingPx = undefined;
      continue;
    }
    m = token.match(/^leading-(none|tight|snug|normal|relaxed|loose)$/);
    if (m) {
      leadingMul = LEADING[m[1]];
      leadingPx = undefined;
      continue;
    }
    m = token.match(/^leading-(\d+)$/);
    if (m) {
      leadingPx = Number(m[1]) * 4;
      leadingMul = undefined;
    }
  }

  if (size == null) return {};
  const fontSize = half(size * TYPE_SCALE);
  let lineHeight: number | undefined;
  if (leadingPx != null) lineHeight = half(leadingPx * TYPE_SCALE);
  else if (leadingMul != null) lineHeight = half(fontSize * leadingMul);
  else if (namedLine != null) lineHeight = half(namedLine * TYPE_SCALE);
  return { fontSize, lineHeight };
}
