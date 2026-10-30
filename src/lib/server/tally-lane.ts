// Per-award publish lane for tally snapshots (kept free of Ably so tests can drive it with a fake).
//
// Why (QA v0.5.0, P1): Ably refuses more than 50 messages/s on one channel (error 42913
// "channel.maxRate", measured on the dev app 30 Oct 2026). From Vercel sin1 a publish round trip is
// a few ms, so one instance coalescing "one in flight at a time" still sent well over 50/s in a
// rush — and several instances add up. The newest snapshots were refused, the old code retried
// once *immediately* (same refused second) and gave up, so the stage sat on an older total until
// the 15 s resync. The lane now (1) spaces publishes per award per instance, and (2) on a rate
// refusal backs off and retries with the newest snapshot instead of dropping it.
import type { TallySnapshot } from "@/lib/types";

export type SendResult = "ok" | "rate_limited" | "failed";
export type Send = (s: TallySnapshot) => Promise<SendResult>;

export type LaneOptions = {
  minGapMs: number; // spacing between two publishes of one award from one instance
  backoffMs: (attempt: number) => number; // wait after a rate refusal (attempt = 1, 2, …)
  giveUpMs: number; // stop retrying a refused snapshot after this long (the stage resync covers it)
  maxFailures: number; // non-rate errors in a row before a snapshot is dropped
};

export const DEFAULT_LANE: LaneOptions = {
  // ≤ 10 msg/s per instance per award → 5 busy instances still fit under Ably's 50/s
  minGapMs: 100,
  // jittered so instances refused in the same second don't come back in lockstep
  backoffMs: (n) => Math.min(1_000, 150 * 2 ** (n - 1)) * (0.6 + Math.random() * 0.4),
  giveUpMs: 10_000,
  maxFailures: 2,
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Lane = {
  inflight: Promise<void> | null;
  next: TallySnapshot | null;
  doneSeq: number; // every seq ≤ this has been published (or given up on)
  ok: boolean;
  lastAt: number;
};

// Every snapshot is the whole tally, so per award we keep at most one publish in flight and send
// only the newest snapshot that queued up behind it. Each caller resolves once a snapshot at least
// as new as its own has gone out (true) or the lane gave up on it (false).
export function createTallyPublisher(send: Send, opts: LaneOptions = DEFAULT_LANE) {
  const lanes = new Map<number, Lane>();

  async function drain(l: Lane) {
    let refusedSince = 0;
    let attempt = 0;
    let failures = 0;
    while (l.next) {
      const wait = l.lastAt + opts.minGapMs - Date.now();
      if (wait > 0) await sleep(wait);
      const snap = l.next!; // newest at the moment we actually send
      l.next = null;
      const r = await send(snap);
      l.lastAt = Date.now();
      const requeue = () => {
        if (!l.next || l.next.seq < snap.seq) l.next = snap;
      };
      if (r === "ok") {
        l.ok = true;
        l.doneSeq = Math.max(l.doneSeq, snap.seq);
        refusedSince = attempt = failures = 0;
      } else if (r === "rate_limited" && (refusedSince === 0 || Date.now() - refusedSince < opts.giveUpMs)) {
        refusedSince ||= Date.now();
        attempt += 1;
        requeue();
        await sleep(opts.backoffMs(attempt));
      } else if (r === "failed" && ++failures < opts.maxFailures) {
        requeue();
      } else {
        l.ok = false;
        l.doneSeq = Math.max(l.doneSeq, snap.seq);
        refusedSince = attempt = failures = 0;
      }
    }
    l.inflight = null;
  }

  return function publishTally(s: TallySnapshot): Promise<boolean> {
    let l = lanes.get(s.award_id);
    if (!l) {
      l = { inflight: null, next: null, doneSeq: -1, ok: true, lastAt: 0 };
      lanes.set(s.award_id, l);
    }
    const lane = l;
    if (s.seq > lane.doneSeq && (!lane.next || s.seq > lane.next.seq)) lane.next = s;
    if (!lane.inflight && lane.next) lane.inflight = drain(lane);
    const mine = s.seq;
    return (async () => {
      while (lane.doneSeq < mine && lane.inflight) await lane.inflight;
      return lane.ok;
    })();
  };
}
