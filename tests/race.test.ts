// Race ordering + change detection — pure functions, no DB or network
import { describe, expect, it } from "vitest";
import { nominees } from "@/data/nominees";
import { photoPlace } from "@/app/stage/geometry";
import { LANES, chasingIds, diffRows, idOrderRows, leaderOf, rankRows } from "@/app/stage/race";

const counts = (o: Record<number, number>) => Object.entries(o).map(([k, v]) => [Number(k), v] as [number, number]);
const order = (o: Record<number, number>) => rankRows(counts(o)).map((r) => r.id);

describe("rankRows", () => {
  it("places all 29 exactly once: 8 lanes + 21 strip", () => {
    const rows = rankRows([]);
    expect(rows).toHaveLength(29);
    expect(new Set(rows.map((r) => r.id)).size).toBe(29);
    expect(rows.filter((r) => r.slot < LANES)).toHaveLength(8);
    expect(rows.map((r) => r.slot)).toEqual([...Array(29).keys()]);
  });

  it("equal scores follow the server order, then nominee number; nobody shares a rank", () => {
    const rows = rankRows(counts({ 20: 5, 7: 5, 3: 2 }), [20, 7, 3]);
    expect(rows.slice(0, 3).map((r) => [r.id, r.rank])).toEqual([
      [20, 1],
      [7, 2],
      [3, 3],
    ]);
    expect(rows.map((r) => r.rank)).toEqual([...Array(29).keys()].map((i) => i + 1));
    expect(order({ 20: 5, 7: 5 }).slice(0, 2)).toEqual([7, 20]);
  });

  it("votes always beat the order", () => {
    expect(rankRows(counts({ 1: 2, 2: 3 }), [1, 2])[0].id).toBe(2);
  });

  it("equal scores never swap lanes when unrelated votes arrive or the same snapshot repeats", () => {
    const tied = [25, 18];
    const a = rankRows(counts({ 25: 4, 18: 4, 1: 1 }), [...tied, 1]).map((r) => r.id);
    const b = rankRows(counts({ 25: 4, 18: 4, 1: 2 }), [...tied, 1]).map((r) => r.id);
    const c = rankRows(counts({ 25: 4, 18: 4, 1: 2, 29: 3 }), [...tied, 29, 1]).map((r) => r.id);
    for (const o of [a, b, c]) expect(o.indexOf(25)).toBeLessThan(o.indexOf(18));
  });

  it("every nominee in the strip can climb into a lane at the right slot", () => {
    for (const n of nominees) {
      // n gets 3 votes, nominees 1..8 (or 1..9 skipping n) get 1 — n must lead
      const base: Record<number, number> = {};
      for (let i = 1, k = 0; k < LANES; i++) {
        if (i === n.id) continue;
        base[i] = 1;
        k++;
      }
      const before = rankRows(counts(base)).find((r) => r.id === n.id)!;
      const after = rankRows(counts({ ...base, [n.id]: 3 })).find((r) => r.id === n.id)!;
      expect(after.slot).toBe(0);
      expect(photoPlace(after.slot).s).toBe(1); // lane-size photo
      if (before.slot >= LANES) expect(photoPlace(before.slot).s).toBeLessThan(1);
    }
  });

  it("the 9th-place climber pushes the 8th lane down into the strip", () => {
    const base = counts({ 1: 3, 2: 3, 3: 3, 4: 3, 5: 3, 6: 3, 7: 3, 8: 1 });
    const rows = rankRows([...base, [29, 2]]);
    expect(rows.find((r) => r.id === 29)!.slot).toBe(7);
    expect(rows.find((r) => r.id === 8)!.slot).toBe(8);
  });
});

describe("change detection", () => {
  it("passing someone is an overtake; tying or leaving zero is not", () => {
    const p = rankRows(counts({ 1: 3, 2: 2 }));
    expect(diffRows(p, rankRows(counts({ 1: 3, 2: 3 }))).overtook.size).toBe(0); // tie
    expect([...diffRows(p, rankRows(counts({ 1: 3, 2: 4 }))).overtook]).toEqual([2]);
    expect(diffRows(p, rankRows(counts({ 1: 3, 2: 2, 9: 1 }))).overtook.size).toBe(0); // first vote
  });

  it("reports gains per nominee and a new leader", () => {
    const p = rankRows(counts({ 1: 3, 2: 2 }));
    const c = diffRows(p, rankRows(counts({ 1: 3, 2: 5, 4: 1 })));
    expect(Object.fromEntries(c.gained)).toEqual({ 2: 3, 4: 1 });
    expect(c.newLeader).toBe(2);
    expect(diffRows(p, rankRows(counts({ 1: 4, 2: 2 }))).newLeader).toBeNull(); // same leader
  });

  it("reaching the leader's score second changes nothing; passing it does", () => {
    const p = rankRows(counts({ 1: 3, 2: 2 }), [1, 2]);
    const level = rankRows(counts({ 1: 3, 2: 3 }), [1, 2]);
    expect(leaderOf(level)).toBe(1);
    expect(diffRows(p, level).newLeader).toBeNull();
    const c = diffRows(level, rankRows(counts({ 1: 3, 2: 4 }), [2, 1]));
    expect(c.newLeader).toBe(2);
    expect([...c.overtook]).toEqual([2]);
  });

  it("someone already ahead on equal scores does not overtake by scoring again", () => {
    const p = rankRows(counts({ 1: 3, 2: 3 }), [2, 1]);
    expect(diffRows(p, rankRows(counts({ 1: 3, 2: 4 }), [2, 1])).overtook.size).toBe(0);
  });

  it("an empty board has no leader", () => {
    expect(leaderOf(rankRows([]))).toBeNull();
  });

  it("flags lanes within one vote of the lane above", () => {
    const rows = rankRows(counts({ 1: 10, 2: 9, 3: 5, 4: 5, 5: 1 }));
    expect([...chasingIds(rows)].sort()).toEqual([2, 4]);
  });

  it("hidden start uses nominee order", () => {
    expect(idOrderRows().map((r) => r.id)).toEqual(nominees.map((n) => n.id));
  });
});
