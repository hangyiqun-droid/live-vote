// Publish lanes for the lobby channel (fix9), kept free of Ably so tests can drive them with a fake.
//
// The lobby channel is separate from the vote channel on purpose: Ably's free plan allows 50 msg/s
// per channel, and neither the "scanned N" counter nor a burst of greetings may ever compete with
// the tally. Both lanes below space their publishes per instance and merge what piles up behind a
// publish in flight, so a room of phones costs a handful of messages, never one per phone.
import type { Greeting, GreetingBatch, ScanCount } from "@/lib/types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- greetings: batch whatever queued up, at most one Ably message per `gapMs` per instance ----

export type GreetingLaneOptions = {
  gapMs: number; // spacing between two messages from this instance
  maxBatch: number; // greetings per message
  maxQueue: number; // waiting greetings; beyond this the route says "busy" before taking a slot
};

export const DEFAULT_GREETING_LANE: GreetingLaneOptions = { gapMs: 300, maxBatch: 6, maxQueue: 24 };

type Waiting = { greeting: Greeting; done: (ok: boolean) => void };

export function createGreetingLane(send: (b: GreetingBatch) => Promise<boolean>, opts: GreetingLaneOptions = DEFAULT_GREETING_LANE) {
  const queue: Waiting[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let flushing = false;
  let lastAt = 0;

  function schedule() {
    if (timer || flushing || queue.length === 0) return;
    // First greeting after a quiet moment goes out at once; a rush is paced
    timer = setTimeout(() => void flush(), Math.max(0, lastAt + opts.gapMs - Date.now()));
  }

  async function flush() {
    timer = null;
    const batch = queue.splice(0, opts.maxBatch);
    if (batch.length === 0) return;
    flushing = true;
    let ok = false;
    try {
      ok = await send({ items: batch.map((w) => w.greeting) });
    } catch {
      ok = false;
    }
    flushing = false;
    lastAt = Date.now();
    for (const w of batch) w.done(ok);
    schedule();
  }

  return {
    /** Room for one more? Checked before a sender's slot is used up. */
    canAccept: () => queue.length < opts.maxQueue,
    /** Resolves once the message carrying this greeting was accepted by Ably (true) or not (false). */
    enqueue(greeting: Greeting): Promise<boolean> {
      return new Promise((done) => {
        queue.push({ greeting, done });
        schedule();
      });
    },
    pending: () => queue.length,
  };
}

// ---- scan counter: every message is the whole count, so only the newest one is worth sending ----

export type CountLaneOptions = { gapMs: number; retryMs: number; giveUpMs: number };
export const DEFAULT_COUNT_LANE: CountLaneOptions = { gapMs: 400, retryMs: 800, giveUpMs: 6_000 };

export function createCountPublisher(send: (c: ScanCount) => Promise<boolean>, opts: CountLaneOptions = DEFAULT_COUNT_LANE) {
  let next: ScanCount | null = null;
  let inflight: Promise<void> | null = null;
  let doneAt = -1; // every count with `at` ≤ this has been sent (or given up on)
  let ok = true;
  let lastAt = 0;

  async function drain() {
    let failingSince = 0;
    while (next) {
      const wait = lastAt + opts.gapMs - Date.now();
      if (wait > 0) await sleep(wait);
      const c = next!; // newest at the moment we actually send
      next = null;
      let sent = false;
      try {
        sent = await send(c);
      } catch {
        sent = false;
      }
      lastAt = Date.now();
      if (sent) {
        ok = true;
        doneAt = Math.max(doneAt, c.at);
        failingSince = 0;
      } else if (Date.now() - (failingSince ||= Date.now()) < opts.giveUpMs) {
        if (!next || next.at < c.at) next = c;
        await sleep(opts.retryMs);
      } else {
        ok = false; // the stage's own 15 s resync covers this
        doneAt = Math.max(doneAt, c.at);
        failingSince = 0;
      }
    }
    inflight = null;
  }

  return function publishCount(c: ScanCount): Promise<boolean> {
    if (c.at > doneAt && (!next || c.at > next.at)) next = c;
    if (!inflight && next) inflight = drain();
    return (async () => {
      while (doneAt < c.at && inflight) await inflight;
      return ok;
    })();
  };
}
