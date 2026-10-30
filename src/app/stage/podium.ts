// Who stands where in the reveal scene (SPEC 5.3). Pure — unit-tested in tests/podium.test.ts.
// Nobody shares a place: equal scores go to whoever reached that score first.
import { rankRows } from "./race";

export type Place = {
  rank: number;
  id: number;
  votes: number;
  wonTie: boolean; // the next person has the same score — this one got there first
};

export type Podium = {
  first: Place | null;
  second: Place | null; // right
  third: Place | null; // left
  steps: Place[]; // reveal order: 3rd → 2nd → 1st, only the places that exist
};

export function podium(counts: Iterable<[number, number]>, order?: number[]): Podium {
  // Zero-vote people never stand on the podium, so an award with no votes has no winner (SPEC 5.3)
  const rows = rankRows(counts, order).filter((r) => r.votes > 0);
  const [first = null, second = null, third = null] = rows.slice(0, 3).map(
    (r, i): Place => ({ rank: r.rank, id: r.id, votes: r.votes, wonTie: rows[i + 1]?.votes === r.votes }),
  );
  return { first, second, third, steps: [third, second, first].filter((p): p is Place => p !== null) };
}
