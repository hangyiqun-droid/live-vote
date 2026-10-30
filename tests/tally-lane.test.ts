// QA v0.5.0 P1: several instances publishing one award's tally must not lose the newest snapshot
// to Ably's 50 msg/s per-channel ceiling. Fake Ably: sliding 1 s window, 5 ms round trip (sin1).
import { describe, expect, it } from "vitest";
import { createTallyPublisher, type Send } from "@/lib/server/tally-lane";
import type { TallySnapshot } from "@/lib/types";

const snap = (seq: number): TallySnapshot => ({
  award_id: 1,
  seq,
  status: "open",
  round: 1,
  auto_close_at: null,
  total: seq,
  counts: [[1, seq]],
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fakeAbly(limitPerSecond = 50, rttMs = 5) {
  const accepted: { at: number; seq: number }[] = [];
  let refused = 0;
  const send: Send = async (s) => {
    await sleep(rttMs);
    const now = Date.now();
    if (accepted.filter((a) => now - a.at < 1_000).length >= limitPerSecond) {
      refused += 1;
      return "rate_limited";
    }
    accepted.push({ at: now, seq: s.seq });
    return "ok";
  };
  return { send, accepted, refused: () => refused };
}

// The v0.5.0 lane: one in flight, newest queued, a refusal retried once right away then dropped
function oldPublisher(send: Send) {
  let inflight: Promise<void> | null = null;
  let next: TallySnapshot | null = null;
  return (s: TallySnapshot) => {
    if (!next || s.seq > next.seq) next = s;
    inflight ??= (async () => {
      while (next) {
        const n = next;
        next = null;
        if ((await send(n)) !== "ok") await send(n);
      }
      inflight = null;
    })();
    return inflight;
  };
}

// `instances` publishers (Vercel instances), votes spread round-robin, `votes` within `overMs`
async function rush(make: (send: Send) => (s: TallySnapshot) => Promise<unknown>, instances: number, votes: number, overMs: number) {
  const ably = fakeAbly();
  const pubs = Array.from({ length: instances }, () => make(ably.send));
  const t0 = Date.now();
  await Promise.all(
    Array.from({ length: votes }, async (_, i) => {
      await sleep((i * overMs) / votes);
      await pubs[i % instances](snap(i + 1));
    }),
  );
  const lastVote = t0 + overMs;
  const newest = ably.accepted.find((a) => a.seq === votes);
  return { ably, newestAfterMs: newest ? newest.at - lastVote : null };
}

describe("tally lane under Ably's 50 msg/s channel limit", () => {
  it("reproduces v0.5.0: the newest snapshot is refused and never sent", async () => {
    const { ably, newestAfterMs } = await rush(oldPublisher, 4, 150, 500);
    expect(ably.refused()).toBeGreaterThan(0);
    expect(newestAfterMs).toBeNull();
  });

  for (const [instances, votes] of [
    [1, 100],
    [4, 100],
    [4, 150],
    [8, 150],
  ] as const) {
    it(`${instances} instances, ${votes} votes in 0.5 s → newest snapshot out within 2 s`, async () => {
      const { ably, newestAfterMs } = await rush((send) => createTallyPublisher(send), instances, votes, 500);
      expect(newestAfterMs).not.toBeNull();
      expect(newestAfterMs!).toBeLessThanOrEqual(2_000);
      // newest-wins: far fewer messages than votes
      expect(ably.accepted.length).toBeLessThan(votes);
    });
  }

  it("a single vote on a quiet award goes out at once (no added latency)", async () => {
    const ably = fakeAbly();
    const pub = createTallyPublisher(ably.send);
    const t0 = Date.now();
    expect(await pub(snap(1))).toBe(true);
    expect(Date.now() - t0).toBeLessThan(50);
  });

  it("every caller resolves; a caller resolves only after a snapshot ≥ its own went out", async () => {
    const ably = fakeAbly();
    const pub = createTallyPublisher(ably.send);
    const results = await Promise.all(
      Array.from({ length: 60 }, async (_, i) => {
        const ok = await pub(snap(i + 1));
        return ok && Math.max(...ably.accepted.map((a) => a.seq)) >= i + 1;
      }),
    );
    expect(results.every(Boolean)).toBe(true);
  });

  it("gives up (false) after giveUpMs if Ably keeps refusing — the stage resync covers it", async () => {
    const pub = createTallyPublisher(async () => "rate_limited", {
      minGapMs: 0,
      backoffMs: () => 20,
      giveUpMs: 100,
      maxFailures: 2,
    });
    expect(await pub(snap(1))).toBe(false);
  });
});
