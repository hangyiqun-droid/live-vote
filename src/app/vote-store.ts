// Phone-side memory. "Who I picked" lives only here — the server never knows.

const DEVICE_KEY = "lv_dev";

export type Ballot = {
  nomineeId: number;
  requestId: string;
  outcome: "pending" | "counted" | "already_voted";
};

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // private mode / storage disabled
  }
}

function safeSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // best effort — the server cookie still guards double votes
  }
}

export const loadDeviceId = () => safeGet(DEVICE_KEY);
export const saveDeviceId = (id: string) => safeSet(DEVICE_KEY, id);

// Keyed by round so a reset award starts fresh on the phone too
const ballotKey = (awardId: number, round: number) => `lv_ballot:${awardId}:${round}`;

export function loadBallot(awardId: number, round: number): Ballot | null {
  const raw = safeGet(ballotKey(awardId, round));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Ballot;
  } catch {
    return null;
  }
}

export function saveBallot(awardId: number, round: number, b: Ballot) {
  safeSet(ballotKey(awardId, round), JSON.stringify(b));
}
