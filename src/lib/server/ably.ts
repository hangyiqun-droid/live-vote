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

export type Role = "mobile" | "stage";

// Phones can only hear award statuses — they have no way to read the tally channel
export function capabilityFor(role: Role): Record<string, Ably.capabilityOp[]> {
  if (role === "stage") {
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
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await rest().channels.get(channel).publish(name, data);
      return true;
    } catch {
      // retry once
    }
  }
  return false;
}

export const publishTally = (s: TallySnapshot) => publish(CHANNEL_TALLY, "tally", s);
export const publishEvent = (s: EventState) => publish(CHANNEL_EVENT, "state", s);
