// Who stands where in the reveal scene (SPEC 5.3). Pure — unit-tested in tests/podium.test.ts.
// Shared ranks (1, 1, 3): a tie shares the place, and the next place is skipped.
import { rankRows } from "./race";

export type Place = { rank: number; ids: number[]; votes: number };

export type Podium = {
  winners: Place | null; // rank 1 — one card, or several = "ผู้ชนะร่วม"
  second: Place | null; // rank 2 (right) — missing when first place is shared
  third: Place | null; // rank 3 (left) — missing when 1st or 2nd is shared down past it
  steps: Place[]; // reveal order: 3rd → 2nd → winners, only the places that exist
};

export function podium(counts: Iterable<[number, number]>): Podium {
  // Zero-vote people never stand on the podium, however many are "tied" at 0 (SPEC 5.3)
  const rows = rankRows(counts).filter((r) => r.votes > 0);
  const place = (rank: number): Place | null => {
    const ids = rows.filter((r) => r.rank === rank).map((r) => r.id);
    return ids.length ? { rank, ids, votes: rows.find((r) => r.rank === rank)!.votes } : null;
  };
  const winners = place(1);
  const second = place(2);
  const third = place(3);
  return { winners, second, third, steps: [third, second, winners].filter((p): p is Place => p !== null) };
}
