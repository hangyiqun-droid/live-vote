// How a greeting bubble looks (fix10): colours, tilt and the font-size ladder. Pure data + two pure
// functions, so tests/greeting-tones.test.ts can check the contrast and the stage code stays about layout.

// Fill runs left → right from c1 to c2, text colour is ink. The bright ends of the four group palettes
// (AMBER amber, AZURE sky, JADE green, RUBY rose), neighbours blended in so each bubble is a gradient.
export const TONES = [
  { c1: "#fde047", c2: "#fb923c", ink: "#2b1403" }, // AMBER
  { c1: "#67e8f9", c2: "#60a5fa", ink: "#04223a" }, // AZURE
  { c1: "#86efac", c2: "#2dd4bf", ink: "#04281d" }, // JADE
  { c1: "#fda4af", c2: "#f0abfc", ink: "#3a0620" }, // RUBY
] as const;

// Degrees; uneven on purpose so six bubbles never look lined up
export const TILTS = [-2.2, 1.6, -1.1, 2.4, -1.7, 1.2] as const;

// Biggest first. A bubble starts at the size its length suggests and steps down until the text fits
// its box (greeting-bubbles.tsx). Short and ordinary greetings keep 36 px or more; the steps below that
// only exist so a 60-character message of wide letters is still shown whole inside its bubble.
export const FONT_STEPS = [46, 42, 38, 36, 34, 32, 30, 28, 26, 24] as const;

export function startStep(length: number): number {
  const size = length <= 12 ? 46 : length <= 20 ? 42 : length <= 30 ? 38 : 36;
  return FONT_STEPS.indexOf(size as (typeof FONT_STEPS)[number]);
}

// WCAG relative luminance / contrast ratio of two #rrggbb colours
const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * lin(((n >> 16) & 255) / 255) + 0.7152 * lin(((n >> 8) & 255) / 255) + 0.0722 * lin((n & 255) / 255);
}
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
