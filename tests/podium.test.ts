// SPEC 5.3: reveal order 3 → 2 → 1, equal scores go to whoever reached that score first
import { describe, expect, it } from "vitest";
import { podium } from "@/app/stage/podium";

const c = (pairs: Record<number, number>) => Object.entries(pairs).map(([id, v]) => [Number(id), v] as [number, number]);

describe("podium", () => {
  it("plain 1 / 2 / 3 reveals 3rd, then 2nd, then the winner", () => {
    const p = podium(c({ 4: 9, 7: 6, 2: 3, 1: 1 }));
    expect(p.first).toEqual({ rank: 1, id: 4, votes: 9, wonTie: false });
    expect(p.second).toEqual({ rank: 2, id: 7, votes: 6, wonTie: false });
    expect(p.third).toEqual({ rank: 3, id: 2, votes: 3, wonTie: false });
    expect(p.steps.map((s) => s.rank)).toEqual([3, 2, 1]);
  });

  it("A reaches 5 before B: A wins even with the higher number, one winner only", () => {
    const p = podium(c({ 18: 5, 25: 5, 3: 2 }), [25, 18, 3]);
    expect(p.first).toMatchObject({ id: 25, votes: 5, wonTie: true });
    expect(p.second).toMatchObject({ id: 18, votes: 5, wonTie: false });
    expect(p.third).toMatchObject({ id: 3, wonTie: false });
    expect(p.steps.map((s) => s.rank)).toEqual([3, 2, 1]);
  });

  it("a tie lower down decides 2nd and 3rd the same way, and 3rd can beat 4th on it", () => {
    const p = podium(c({ 1: 7, 2: 4, 3: 4, 4: 2, 5: 2 }), [1, 3, 2, 5, 4]);
    expect([p.first?.id, p.second?.id, p.third?.id]).toEqual([1, 3, 2]);
    expect([p.first?.wonTie, p.second?.wonTie, p.third?.wonTie]).toEqual([false, true, false]);
    const q = podium(c({ 1: 7, 2: 4, 3: 2, 4: 2 }), [1, 2, 4, 3]);
    expect(q.third).toMatchObject({ id: 4, wonTie: true });
  });

  it("everyone level: three places, the order decides each one", () => {
    const counts = Array.from({ length: 29 }, (_, i) => [i + 1, 3] as [number, number]);
    const order = counts.map(([id]) => id).reverse();
    const p = podium(counts, order);
    expect([p.first?.id, p.second?.id, p.third?.id]).toEqual([29, 28, 27]);
    expect(p.steps).toHaveLength(3);
  });

  it("old rows without an order fall back to nominee number", () => {
    expect(podium(c({ 9: 2, 4: 2 })).first?.id).toBe(4);
  });

  it("zero-vote people never stand on the podium", () => {
    const p = podium(c({ 1: 3, 2: 1 }));
    expect(p.first?.id).toBe(1);
    expect(p.second?.id).toBe(2);
    expect(p.third).toBeNull();
  });

  it("no votes at all: nobody is declared the winner", () => {
    const p = podium(c({}), [1, 2, 3]);
    expect(p.first).toBeNull();
    expect(p.steps).toEqual([]);
  });
});
