import "server-only";
import * as Ably from "ably";
import {
  CHANNEL_EVENT,
  CHANNEL_LOBBY,
  CHANNEL_TALLY,
  type EventState,
  type GreetingBatch,
  type ScanCount,
  type TallySnapshot,
} from "@/lib/types";
import { callFn } from "@/db/client";
import { createCountPublisher, createGreetingLane } from "./lobby-lane";
import { createTallyPublisher, type SendResult } from "./tally-lane";

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

// Phones can only hear award statuses — they have no way to read the tally channel, nor the lobby one
// (greetings and the scan count go to the stage only). Stage enters presence on the tally channel;
// the MC page watches it ("is the screen connected").
export function capabilityFor(role: Role): Record<string, Ably.capabilityOp[]> {
  if (role === "stage") {
    return {
      [CHANNEL_EVENT]: ["subscribe"],
      [CHANNEL_TALLY]: ["subscribe", "presence"],
      [CHANNEL_LOBBY]: ["subscribe"],
    };
  }
  if (role === "admin") {
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

// One Ably call for the tally lane (src/lib/server/tally-lane.ts), which owns spacing + retries.
// 42913 = channel.maxRate (50 msg/s per channel) — a rate refusal is worth waiting out.
async function sendTally(snap: TallySnapshot): Promise<SendResult> {
  try {
    await rest().channels.get(CHANNEL_TALLY).publish("tally", snap);
    return "ok";
  } catch (e) {
    const { code, statusCode } = (e ?? {}) as { code?: unknown; statusCode?: unknown };
    const rate = statusCode === 429 || (typeof code === "number" && code >= 42900 && code < 43000);
    console.warn(`[ably] publish ${CHANNEL_TALLY} ${rate ? "rate_limited" : "failed"} code=${String(code ?? "unknown")}`);
    return rate ? "rate_limited" : "failed";
  }
}

// One lane per award per instance; kept on globalThis so dev hot reloads don't fork it
const globalForLanes = globalThis as unknown as { eventPublishTally?: (s: TallySnapshot) => Promise<boolean> };
export const publishTally = (globalForLanes.eventPublishTally ??= createTallyPublisher(sendTally));

export const publishEvent = (s: EventState) => publish(CHANNEL_EVENT, "state", s);

// Lobby channel (fix9): the scan counter (newest wins) and greetings (batched). Nothing here is
// stored; a lost message only means a bubble that never appears, and the counter resyncs in 15 s.
async function sendLobby(name: string, data: unknown): Promise<boolean> {
  try {
    await rest().channels.get(CHANNEL_LOBBY).publish(name, data);
    return true;
  } catch (e) {
    console.warn(`[ably] publish ${CHANNEL_LOBBY} ${name} failed code=${String((e as { code?: unknown })?.code ?? "unknown")}`);
    return false;
  }
}

const globalForLobby = globalThis as unknown as {
  eventPublishCount?: (c: ScanCount) => Promise<boolean>;
  eventGreetingLane?: ReturnType<typeof createGreetingLane>;
};
export const publishScanCount = (globalForLobby.eventPublishCount ??= createCountPublisher((c) => sendLobby("count", c)));
export const greetingLane = (globalForLobby.eventGreetingLane ??= createGreetingLane((b: GreetingBatch) => sendLobby("greet", b), {
  gapMs: 300,
  maxBatch: 6,
  maxQueue: 24,
  // Checked again right before publishing: the MC may have switched greetings off since the gate said ok
  stillOpen: async () => {
    try {
      return (await callFn<boolean>("greetings_open")) === true;
    } catch {
      return false; // cannot tell → show nothing
    }
  },
}));
