// a rush of votes publishes only the newest whole-tally snapshot per award (Ably dev app)
import * as Ably from "ably";
import { afterAll, describe, expect, it } from "vitest";
import { publishTally } from "@/lib/server/ably";
import { CHANNEL_TALLY, type TallySnapshot } from "@/lib/types";

// An award id the stage never shows, so a dev stage left open ignores these messages
const AWARD = 97;
const sub = new Ably.Realtime({ key: process.env.ABLY_API_KEY!, logLevel: 0 } as Ably.ClientOptions);
afterAll(() => sub.close());

const snap = (seq: number): TallySnapshot => ({
  award_id: AWARD,
  seq,
  status: "open",
  round: 1,
  auto_close_at: null,
  total: seq,
  counts: [[1, seq]],
  order: [1],
});

describe("publishTally coalescing", () => {
  it("60 votes at once → every caller answered, far fewer messages, newest one arrives last", async () => {
    const seen: number[] = [];
    const channel = sub.channels.get(CHANNEL_TALLY);
    await channel.subscribe("tally", (m) => {
      const s = m.data as TallySnapshot;
      if (s.award_id === AWARD) seen.push(s.seq);
    });

    const base = Date.now(); // unique seqs per run, still monotonic
    const results = await Promise.all(Array.from({ length: 60 }, (_, i) => publishTally(snap(base + i))));
    expect(results.every(Boolean)).toBe(true);

    const deadline = Date.now() + 5_000;
    while (!seen.includes(base + 59) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    expect(seen.at(-1)).toBe(base + 59);
    expect(seen.length).toBeLessThan(10);
    // Never goes backwards
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
  });
});
