// the greeting bubble colours — dark text on every part of every gradient must reach 4.5:1
import { describe, expect, it } from "vitest";
import { FONT_STEPS, TILTS, TONES, contrast, startStep } from "@/app/stage/bubble-style";

describe("bubble tones", () => {
  it.each(TONES.map((t, i) => [i, t] as const))("tone %i: text stays ≥ 4.5:1 on both ends of its gradient", (_i, t) => {
    expect(contrast(t.ink, t.c1)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t.ink, t.c2)).toBeGreaterThanOrEqual(4.5);
  });

  it("the four tones are different from each other", () => {
    expect(new Set(TONES.map((t) => t.c1 + t.c2)).size).toBe(TONES.length);
  });

  it("the contrast helper agrees with known values", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(contrast("#777777", "#777777")).toBeCloseTo(1, 5);
  });
});

describe("bubble tilt and type", () => {
  it("tilts are small, uneven and not all the same direction", () => {
    expect(Math.max(...TILTS.map(Math.abs))).toBeLessThanOrEqual(3);
    expect(new Set(TILTS).size).toBe(TILTS.length);
    expect(TILTS.some((t) => t > 0) && TILTS.some((t) => t < 0)).toBe(true);
  });

  it("font steps go down, anything ordinary starts at 36 px or more", () => {
    expect([...FONT_STEPS]).toEqual([...FONT_STEPS].sort((a, b) => b - a));
    for (const len of [1, 12, 13, 20, 21, 30, 31, 60]) expect(FONT_STEPS[startStep(len)]).toBeGreaterThanOrEqual(36);
    expect(FONT_STEPS[startStep(5)]).toBeGreaterThan(FONT_STEPS[startStep(60)]);
  });
});
