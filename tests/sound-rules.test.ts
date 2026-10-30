// Sound throttling (SPEC 6.4) and which race moments get a sound (SPEC 6.1) — pure, no audio
import { describe, expect, it } from "vitest";
import { raceSound, rankRows } from "@/app/stage/race";
import { BUS_OF, MomentRules, TICKS_PER_SEC, TickRules } from "@/app/stage/sound/rules";
import { SPRITE } from "@/app/stage/sound/sprite";

const counts = (o: Record<number, number>) => rankRows(Object.entries(o).map(([k, v]) => [Number(k), v] as [number, number]));

// Feed a steady stream: `perCommit` votes every 250 ms for `ms`
function stream(rules: TickRules, perCommit: number, ms: number, from = 0) {
  const plays: { at: number; key: string; gain: number; rate: number }[] = [];
  for (let t = from; t < from + ms; t += 250) for (const p of rules.votes(perCommit, t)) plays.push({ at: t + p.delay, ...p });
  return plays;
}

describe("TickRules", () => {
  it("one vote = one tick at full volume, pitch within ±10 %", () => {
    const r = new TickRules(() => 1);
    const [p] = r.votes(1, 0);
    expect(p).toMatchObject({ key: "sfx_tick", delay: 0, gain: 1 });
    expect(p.rate).toBeCloseTo(1.1);
    expect(new TickRules(() => 0).votes(1, 0)[0].rate).toBeCloseTo(0.9);
  });

  it("never more than 6 ticks in any one second", () => {
    const plays = stream(new TickRules(), 3, 10_000).filter((p) => p.key === "sfx_tick");
    for (const p of plays) expect(plays.filter((q) => q.at >= p.at && q.at < p.at + 1000).length).toBeLessThanOrEqual(TICKS_PER_SEC);
  });

  it("4+ votes in one commit become a single burst, at most one per 300 ms", () => {
    const r = new TickRules();
    expect(r.votes(4, 0).map((p) => p.key)).toEqual(["sfx_burst"]);
    expect(r.votes(25, 250)).toEqual([]); // 250 ms later: too soon for another burst
    expect(r.votes(25, 500).map((p) => p.key)).toEqual(["sfx_burst"]);
  });

  it("100 votes in 1 s plays only a handful of sounds", () => {
    const plays = stream(new TickRules(), 25, 1000);
    expect(plays.length).toBeLessThanOrEqual(4);
    expect(plays.every((p) => p.key === "sfx_burst")).toBe(true);
  });

  it("100 votes in 10 s: ticks capped, the rest folded into bursts", () => {
    const r = new TickRules();
    const plays: string[] = [];
    // 2–3 votes per commit, like the real 250 ms buffer at ~10 votes a second
    for (let t = 0, i = 0; t < 10_000; t += 250, i++) plays.push(...r.votes(i % 2 ? 3 : 2, t).map((p) => p.key));
    expect(plays.filter((k) => k === "sfx_tick").length).toBeLessThanOrEqual(6 * 10);
    expect(plays.filter((k) => k === "sfx_burst").length).toBeGreaterThan(0);
  });

  it("ticks get softer in a long streak and recover after 2 s of quiet", () => {
    const r = new TickRules();
    const gains = stream(r, 1, 3000).map((p) => p.gain);
    expect(gains.at(-1)!).toBeLessThan(gains[0]);
    expect(Math.min(...gains)).toBeGreaterThanOrEqual(0.4);
    expect(r.votes(1, 3000 + 2500)[0].gain).toBe(1);
  });
});

describe("MomentRules", () => {
  it("overtake at most once per 1.5 s", () => {
    const m = new MomentRules();
    expect(m.allow("sfx_overtake", 0)).toBe(true);
    expect(m.allow("sfx_overtake", 1000)).toBe(false);
    expect(m.allow("sfx_overtake", 1600)).toBe(true);
  });

  it("a new leader beats an overtake that comes right after it", () => {
    const m = new MomentRules();
    expect(m.allow("sfx_leader", 0)).toBe(true);
    expect(m.allow("sfx_overtake", 400)).toBe(false);
    expect(m.allow("sfx_leader", 400)).toBe(false); // and the sting does not stack either
  });

  it("other sounds are never held back", () => {
    const m = new MomentRules();
    expect([0, 10, 20].map((t) => m.allow("sfx_open", t))).toEqual([true, true, true]);
  });
});

describe("raceSound", () => {
  it("counts every vote of the commit", () => {
    expect(raceSound(counts({ 1: 2 }), counts({ 1: 3, 5: 2 }), false).votes).toBe(3);
  });

  it("new leader → leader sting (not also an overtake)", () => {
    expect(raceSound(counts({ 1: 3, 2: 2 }), counts({ 1: 3, 2: 4 }), false).moment).toBe("sfx_leader");
  });

  it("passing someone inside the top 8 → overtake", () => {
    expect(raceSound(counts({ 1: 9, 2: 5, 3: 4 }), counts({ 1: 9, 2: 5, 3: 6 }), false).moment).toBe("sfx_overtake");
  });

  it("closing to within one vote of the lane above → chase", () => {
    expect(raceSound(counts({ 1: 9, 2: 5, 3: 2 }), counts({ 1: 9, 2: 5, 3: 4 }), false).moment).toBe("sfx_chase");
  });

  it("while counts are hidden only the tick plays", () => {
    expect(raceSound(counts({ 1: 3, 2: 2 }), counts({ 1: 3, 2: 4 }), true)).toEqual({ votes: 2, moment: null });
  });
});

describe("sprite", () => {
  it("has every effect of SPEC 6.1, non-overlapping, on the right bus", () => {
    const keys = ["sfx_tick", "sfx_burst", "sfx_overtake", "sfx_leader", "sfx_chase", "sfx_open", "sfx_count", "sfx_close", "sfx_drumroll", "sfx_place", "sfx_reveal", "sfx_applause"];
    expect(Object.keys(SPRITE).sort()).toEqual([...keys].sort());
    const spans = Object.values(SPRITE).sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < spans.length; i++) expect(spans[i][0]).toBeGreaterThanOrEqual(spans[i - 1][0] + spans[i - 1][1]);
    expect(BUS_OF("sfx_applause")).toBe("show");
    expect(BUS_OF("sfx_tick")).toBe("sfx");
  });
});
