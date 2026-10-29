// Pure ranking + change detection for the race screen (SPEC 5.1, 5.2). No React, no DOM —
// unit-tested in tests/race.test.ts.
import { nominees } from "@/data/nominees";

export const LANES = 8; // Top 8 get a full lane; ranks 9–29 sit in the bottom strip

export type Row = {
  id: number;
  votes: number;
  rank: number; // shared rank on ties: 1, 1, 3 (SPEC 5.1)
  slot: number; // 0..28 screen position; < LANES = lane, else strip
};

// Ties sort by nominee number so equal scores never swap back and forth (SPEC 5.1)
export function rankRows(counts: Iterable<[number, number]>): Row[] {
  const votes = new Map(counts);
  const sorted = nominees
    .map((n) => ({ id: n.id, votes: votes.get(n.id) ?? 0 }))
    .sort((a, b) => b.votes - a.votes || a.id - b.id);
  let rank = 1;
  return sorted.map((r, slot) => {
    if (slot > 0 && r.votes < sorted[slot - 1].votes) rank = slot + 1;
    return { ...r, rank, slot };
  });
}

// Shown when the screen starts with counts already hidden: nominee order leaks nothing
export function idOrderRows(): Row[] {
  return nominees.map((n, slot) => ({ id: n.id, votes: 0, rank: slot + 1, slot }));
}

// Sole leader with at least one vote, or null (empty / shared first place)
export function leaderOf(rows: Row[]): number | null {
  if (!rows.length || rows[0].votes === 0) return null;
  if (rows.length > 1 && rows[1].votes === rows[0].votes) return null;
  return rows[0].id;
}

// Lanes 2–8 within one vote of the lane above get the "closing in" flame (SPEC 5.2)
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
  overtook: Set<number>; // passed someone who was level with or ahead of them
  newLeader: number | null;
};

export function diffRows(prev: Row[], next: Row[]): RaceChange {
  const before = new Map(prev.map((r) => [r.id, r.votes]));
  const gained = new Map<number, number>();
  const overtook = new Set<number>();
  for (const r of next) {
    const d = r.votes - (before.get(r.id) ?? 0);
    if (d > 0) gained.set(r.id, d);
  }
  for (const id of gained.keys()) {
    const was = before.get(id) ?? 0;
    const now = next.find((r) => r.id === id)!.votes;
    // Strictly ahead of someone who had votes and was level or ahead — ties and leaving the
    // zero-vote pack are not overtakes
    const passed = next.some((o) => {
      const b = before.get(o.id) ?? 0;
      return o.id !== id && b > 0 && b >= was && o.votes < now;
    });
    if (passed) overtook.add(id);
  }
  const lead = leaderOf(next);
  return { gained, overtook, newLeader: lead !== null && lead !== leaderOf(prev) ? lead : null };
}
