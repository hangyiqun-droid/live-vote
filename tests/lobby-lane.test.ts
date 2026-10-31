// fix9: the lobby publish lanes — a room full of phones costs a handful of Ably messages
import { describe, expect, it } from "vitest";
import { createCountPublisher, createGreetingLane } from "@/lib/server/lobby-lane";
import type { GreetingBatch, ScanCount } from "@/lib/types";

const g = (i: number) => ({ id: `g${i}`, text: `สวัสดี ${i}` });

describe("greeting lane", () => {
  it("40 greetings at once → batched messages, in order, none lost, spaced out", async () => {
    const sent: { at: number; batch: GreetingBatch }[] = [];
    const lane = createGreetingLane(async (batch) => {
      sent.push({ at: Date.now(), batch });
      return true;
    }, { gapMs: 60, maxBatch: 6, maxQueue: 100 });

    const results = await Promise.all(Array.from({ length: 40 }, (_, i) => lane.enqueue(g(i))));
    expect(results.every((r) => r === "sent")).toBe(true);
    const ids = sent.flatMap((s) => s.batch.items.map((x) => x.id));
    expect(ids).toEqual(Array.from({ length: 40 }, (_, i) => `g${i}`));
    expect(sent.length).toBeLessThanOrEqual(10); // 40 / 6 → 7 messages, never 40
    expect(sent.every((s) => s.batch.items.length <= 6)).toBe(true);
    for (let i = 1; i < sent.length; i++) expect(sent[i].at - sent[i - 1].at).toBeGreaterThanOrEqual(50);
  });

  it("the first greeting after a quiet moment goes out at once", async () => {
    const started = Date.now();
    const lane = createGreetingLane(async () => true, { gapMs: 500, maxBatch: 6, maxQueue: 10 });
    await lane.enqueue(g(1));
    expect(Date.now() - started).toBeLessThan(200);
  });

  it("a full queue answers busy at once — even when 120 requests pass canAccept() together", async () => {
    const sent: number[] = [];
    const lane = createGreetingLane(async (b) => (sent.push(b.items.length), true), { gapMs: 20, maxBatch: 6, maxQueue: 24 });
    // every caller saw canAccept() = true before any of them enqueued (the QA lane-race case)
    const answers = await Promise.all(Array.from({ length: 120 }, (_, i) => (lane.canAccept() ? lane.enqueue(g(i)) : Promise.resolve("busy"))));
    expect(answers.filter((a) => a === "sent")).toHaveLength(24);
    expect(answers.filter((a) => a === "busy")).toHaveLength(96);
    expect(sent.reduce((a, b) => a + b, 0)).toBe(24);
    expect(lane.pending()).toBe(0);
  });

  it("tells every sender if Ably refused", async () => {
    const lane = createGreetingLane(async () => false, { gapMs: 20, maxBatch: 2, maxQueue: 4 });
    const pending = [1, 2, 3, 4].map((i) => lane.enqueue(g(i)));
    expect(lane.canAccept()).toBe(false);
    expect(await Promise.all(pending)).toEqual(["failed", "failed", "failed", "failed"]);
    expect(lane.canAccept()).toBe(true);
  });

  it("drops a batch whose switch was closed after the gate said ok — nothing is published", async () => {
    let open = true;
    const published: string[] = [];
    const lane = createGreetingLane(async (b) => (published.push(...b.items.map((x) => x.id)), true), {
      gapMs: 10,
      maxBatch: 3,
      maxQueue: 10,
      stillOpen: async () => open,
    });
    expect(await lane.enqueue(g(1))).toBe("sent");
    const waiting = [g(2), g(3)].map((x) => lane.enqueue(x));
    open = false; // MC flips the switch while they wait
    expect(await Promise.all(waiting)).toEqual(["closed", "closed"]);
    expect(published).toEqual(["g1"]);
    open = true;
    expect(await lane.enqueue(g(4))).toBe("sent");
    expect(published).toEqual(["g1", "g4"]);
  });

  it("a send that throws counts as failed, the lane keeps working", async () => {
    let n = 0;
    const lane = createGreetingLane(async () => {
      if (n++ === 0) throw new Error("boom");
      return true;
    }, { gapMs: 10, maxBatch: 1, maxQueue: 10 });
    expect(await lane.enqueue(g(1))).toBe("failed");
    expect(await lane.enqueue(g(2))).toBe("sent");
  });
});

describe("scan count lane", () => {
  const c = (count: number, rev: number): ScanCount => ({ count, rev });

  it("100 arrivals at once → a few messages, the newest count arrives last", async () => {
    const sent: number[] = [];
    const publish = createCountPublisher(async (x) => (sent.push(x.count), true), { gapMs: 30, retryMs: 10, giveUpMs: 500 });
    const results = await Promise.all(Array.from({ length: 100 }, (_, i) => publish(c(i + 1, 1000 + i))));
    expect(results.every(Boolean)).toBe(true);
    expect(sent.at(-1)).toBe(100);
    expect(sent.length).toBeLessThan(5);
    expect([...sent].sort((a, b) => a - b)).toEqual(sent);
  });

  it("retries a refused count with the newest value, then gives up politely", async () => {
    let calls = 0;
    const publish = createCountPublisher(async () => (calls++ >= 2 ? true : false), { gapMs: 5, retryMs: 5, giveUpMs: 1000 });
    expect(await publish(c(5, 10))).toBe(true);
    expect(calls).toBe(3);

    const never = createCountPublisher(async () => false, { gapMs: 5, retryMs: 5, giveUpMs: 60 });
    expect(await never(c(6, 20))).toBe(false);
  });
});
