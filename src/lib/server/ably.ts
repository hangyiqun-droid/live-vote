import "server-only";
import * as Ably from "ably";
import { CHANNEL_EVENT, CHANNEL_TALLY, type EventState, type TallySnapshot } from "@/lib/types";

// Ably is only the loudspeaker; Postgres is the ballot box (SPEC 1.1).
const globalForAbly = globalThis as unknown as { eventAbly?: Ably.Rest };

function rest(): Ably.Rest {
  if (!globalForAbly.eventAbly) {
    const key = process.env.ABLY_API_KEY;
    if (!key) throw new Error("ABLY_API_KEY is not set");
    globalForAbly.eventAbly = new Ably.Rest({ key });
  }
  return globalForAbly.eventAbly;
}

export type Role = "mobile" | "stage" | "admin";

// Phones can only hear award statuses — they have no way to read the tally channel.
// Stage enters presence on the tally channel; the MC page watches it ("is the screen connected").
export function capabilityFor(role: Role): Record<string, Ably.capabilityOp[]> {
  if (role === "stage" || role === "admin") {
    return {
      [CHANNEL_EVENT]: ["subscribe"],
      [CHANNEL_TALLY]: ["subscribe", "presence"],
    };
  }
  return { [CHANNEL_EVENT]: ["subscribe"] };
}

export async function createTokenRequest(role: Role, clientId?: string) {
  return rest().auth.createTokenRequest({
    capability: JSON.stringify(capabilityFor(role)),
    clientId,
    ttl: 60 * 60 * 1000,
  });
}

// Await + one retry. A failed publish never loses a vote — the stage resyncs from the DB.
async function publish(channel: string, name: string, data: unknown): Promise<boolean> {
  let code: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await rest().channels.get(channel).publish(name, data);
      return true;
    } catch (e) {
      code = (e as { code?: unknown })?.code;
    }
  }
  console.warn(`[ably] publish ${channel} failed code=${String(code ?? "unknown")}`);
  return false;
}

// M5: a rush of votes must not turn into a rush of publishes — Ably refuses messages above its
// per-channel / per-account rate (SPEC 1.3) and the stage would sit on a stale total until the
// 15 s resync. Every snapshot is the whole tally, so per award we keep at most one publish in
// flight and send only the newest snapshot that queued up behind it. Each caller still waits
// until a snapshot at least as new as its own has gone out (or failed), so "announce before
// replying" holds.
type Lane = { inflight: Promise<void> | null; next: TallySnapshot | null; sentSeq: number; ok: boolean };
const globalForLanes = globalThis as unknown as { eventTallyLanes?: Map<number, Lane> };
const lanes = (globalForLanes.eventTallyLanes ??= new Map());

export function publishTally(s: TallySnapshot): Promise<boolean> {
  let lane = lanes.get(s.award_id);
  if (!lane) {
    lane = { inflight: null, next: null, sentSeq: -1, ok: true };
    lanes.set(s.award_id, lane);
  }
  const l = lane;
  if (!l.next || s.seq > l.next.seq) l.next = s;
  if (!l.inflight) {
    l.inflight = (async () => {
      while (l.next) {
        const snap = l.next;
        l.next = null;
        l.ok = await publish(CHANNEL_TALLY, "tally", snap);
        l.sentSeq = Math.max(l.sentSeq, snap.seq);
      }
      l.inflight = null;
    })();
  }
  const mine = s.seq;
  return (async () => {
    while (l.sentSeq < mine && l.inflight) await l.inflight;
    return l.ok;
  })();
}

export const publishEvent = (s: EventState) => publish(CHANNEL_EVENT, "state", s);
