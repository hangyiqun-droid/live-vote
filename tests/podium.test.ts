// SPEC 5.3: reveal order 3 → 2 → 1 with shared places ("ชนะร่วม")
import { describe, expect, it } from "vitest";
import { podium } from "@/app/stage/podium";

const c = (pairs: Record<number, number>) => Object.entries(pairs).map(([id, v]) => [Number(id), v] as [number, number]);

describe("podium", () => {
  it("plain 1 / 2 / 3 reveals 3rd, then 2nd, then the winner", () => {
    const p = podium(c({ 4: 9, 7: 6, 2: 3, 1: 1 }));
    expect(p.winners).toEqual({ rank: 1, ids: [4], votes: 9 });
    expect(p.second).toEqual({ rank: 2, ids: [7], votes: 6 });
    expect(p.third).toEqual({ rank: 3, ids: [2], votes: 3 });
    expect(p.steps.map((s) => s.rank)).toEqual([3, 2, 1]);
  });

  it("tie at 1st: joint winners, no 2nd place, 3rd shown first (1, 1, 3)", () => {
    const p = podium(c({ 18: 5, 25: 5, 3: 2, 9: 1 }));
    expect(p.winners?.ids).toEqual([18, 25]);
    expect(p.second).toBeNull();
    expect(p.third).toEqual({ rank: 3, ids: [3], votes: 2 });
    expect(p.steps.map((s) => s.rank)).toEqual([3, 1]);
  });

  it("tie at 2nd: two cards side by side in 2nd, no 3rd (1, 2, 2)", () => {
    const p = podium(c({ 1: 7, 2: 4, 3: 4, 5: 1 }));
    expect(p.winners?.ids).toEqual([1]);
    expect(p.second?.ids).toEqual([2, 3]);
    expect(p.third).toBeNull();
    expect(p.steps.map((s) => s.rank)).toEqual([2, 1]);
  });

  it("tie at 3rd: shared 3rd place", () => {
    const p = podium(c({ 1: 7, 2: 4, 3: 2, 4: 2, 5: 2 }));
    expect(p.third?.ids).toEqual([3, 4, 5]);
    expect(p.steps.map((s) => s.rank)).toEqual([3, 2, 1]);
  });

  it("zero-vote people never stand on the podium", () => {
    const p = podium(c({ 1: 3, 2: 1 }));
    expect(p.winners?.ids).toEqual([1]);
    expect(p.second?.ids).toEqual([2]);
    expect(p.third).toBeNull();
  });

  it("no votes at all: empty podium", () => {
    const p = podium(c({}));
    expect(p.winners).toBeNull();
    expect(p.steps).toEqual([]);
  });
});
