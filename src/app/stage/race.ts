// Pure ranking + change detection for the race screen. No React, no DOM —
// unit-tested in tests/race.test.ts.
import { nominees } from "@/data/nominees";

export const LANES = 8; // Top 8 get a full lane; ranks 9–29 sit in the bottom strip

export type Row = {
  id: number;
  votes: number;
  rank: number; // slot + 1: nobody shares a place, equal scores are decided by `order`
  slot: number; // 0..28 screen position; < LANES = lane, else strip
};

// Most votes first; equal scores follow the server's `order` (who reached that score first), then
// nominee number. Every screen ranks through here, and a settled order never swaps back and forth.
export function rankRows(counts: Iterable<[number, number]>, order: number[] = []): Row[] {
  const votes = new Map(counts);
  const place = new Map(order.map((id, i) => [id, i]));
  const at = (id: number) => place.get(id) ?? Infinity;
  return nominees
    .map((n) => ({ id: n.id, votes: votes.get(n.id) ?? 0 }))
    .sort((a, b) => b.votes - a.votes || at(a.id) - at(b.id) || a.id - b.id)
    .map((r, slot) => ({ ...r, rank: slot + 1, slot }));
}

// Shown when the screen starts with counts already hidden: nominee order leaks nothing
export function idOrderRows(): Row[] {
  return nominees.map((n, slot) => ({ id: n.id, votes: 0, rank: slot + 1, slot }));
}

// Leader with at least one vote, or null (empty)
export function leaderOf(rows: Row[]): number | null {
  return rows.length && rows[0].votes > 0 ? rows[0].id : null;
}

// Lanes 2–8 within one vote of the lane above get the "closing in" flame
export function chasingIds(rows: Row[]): Set<number> {
  const out = new Set<number>();
  for (let i = 1; i < Math.min(LANES, rows.length); i++) {
    const r = rows[i];
    if (r.votes > 0 && rows[i - 1].votes - r.votes <= 1) out.add(r.id);
  }
  return out;
}

export type RaceChange = {
  gained: Map<number, number>; // id → votes gained since the last commit
  overtook: Set<number>; // moved above someone who was above them
  newLeader: number | null;
};

export function diffRows(prev: Row[], next: Row[]): RaceChange {
  const before = new Map(prev.map((r) => [r.id, r.votes]));
  const wasAt = new Map(prev.map((r) => [r.id, r.slot]));
  const gained = new Map<number, number>();
  const overtook = new Set<number>();
  for (const r of next) {
    const d = r.votes - (before.get(r.id) ?? 0);
    if (d > 0) gained.set(r.id, d);
  }
  for (const id of gained.keys()) {
    const slot = next.find((r) => r.id === id)!.slot;
    const from = wasAt.get(id) ?? Infinity;
    // Above someone who had votes and was above them — reaching their score second is not an
    // overtake, and neither is leaving the zero-vote pack
    const passed = next.some((o) => (before.get(o.id) ?? 0) > 0 && (wasAt.get(o.id) ?? Infinity) < from && o.slot > slot);
    if (passed) overtook.add(id);
  }
  const lead = leaderOf(next);
  return { gained, overtook, newLeader: lead !== null && lead !== leaderOf(prev) ? lead : null };
}

export type RaceSound = { votes: number; moment: "sfx_leader" | "sfx_overtake" | "sfx_chase" | null };

// Which sounds one commit of the race deserves. While counts are hidden only the
// tick plays — it tells the room votes are landing without saying for whom.
export function raceSound(prev: Row[], next: Row[], hide: boolean): RaceSound {
  const change = diffRows(prev, next);
  let votes = 0;
  for (const d of change.gained.values()) votes += d;
  if (hide) return { votes, moment: null };
  const slot = new Map(next.map((r) => [r.id, r.slot]));
  if (change.newLeader !== null) return { votes, moment: "sfx_leader" };
  if ([...change.overtook].some((id) => slot.get(id)! < LANES)) return { votes, moment: "sfx_overtake" };
  // A lane that just closed to within one vote of the lane above it
  const was = chasingIds(prev);
  const now = [...chasingIds(next)].some((id) => !was.has(id) && change.gained.has(id));
  return { votes, moment: now ? "sfx_chase" : null };
}
