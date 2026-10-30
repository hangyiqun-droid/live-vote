// fix2: transient DB errors (QA v0.5.1 preview logs: "out of memory", "deadlock detected") are
// retried inside callFn before a route answers 503 — but never in a way that could run a
// non-idempotent function twice.
import type { PoolClient } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { callFn, pool } from "@/db/client";
import { isRetryable, retryDelay } from "@/db/retry";

const pgError = (code: string, message = code) => Object.assign(new Error(message), { code });
const socketError = () => Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });

// A fake pool client whose query() plays the given script: an Error is thrown, anything else is returned as r
function fakeClient(step: () => unknown) {
  const release = vi.fn();
  const client = {
    query: vi.fn(async () => {
      const v = step();
      if (v instanceof Error) throw v;
      return { rows: [{ r: v }] };
    }),
    release,
  } as unknown as PoolClient;
  return { client, release };
}

afterEach(() => vi.restoreAllMocks());

describe("isRetryable", () => {
  it("retries errors Postgres reports itself (nothing committed)", () => {
    for (const code of ["53200", "40P01", "53300", "57P03", "40001"]) {
      expect(isRetryable(pgError(code), "query", "rolled-back")).toBe(true);
    }
  });
  it("never retries real bugs or constraint errors", () => {
    expect(isRetryable(pgError("42883", "function does not exist"), "query", "always")).toBe(false);
    expect(isRetryable(pgError("23505"), "query", "always")).toBe(false);
    expect(isRetryable(new Error("boom"), "connect", "always")).toBe(false);
  });
  it("a socket that broke mid-query is retried only for idempotent calls", () => {
    expect(isRetryable(socketError(), "query", "always")).toBe(true);
    expect(isRetryable(socketError(), "query", "rolled-back")).toBe(false);
    expect(isRetryable(new Error("timeout exceeded when trying to connect"), "connect", "rolled-back")).toBe(true);
  });
  it("backs off 100 → 250 → 500 ms with ≤ 50% jitter", () => {
    expect([1, 2, 3].map((a) => retryDelay(a, () => 0))).toEqual([100, 250, 500]);
    expect(retryDelay(3, () => 1)).toBe(750);
  });
});

describe("callFn retry", () => {
  it("out of memory twice, then the vote lands → one answer, no 503", async () => {
    let n = 0;
    const clients: ReturnType<typeof fakeClient>[] = [];
    vi.spyOn(pool, "connect").mockImplementation((async () => {
      const c = fakeClient(() => (++n <= 2 ? pgError("53200", "out of memory") : { result: "counted" }));
      clients.push(c);
      return c.client;
    }) as typeof pool.connect);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(callFn("cast_vote", [1, 2, "x", "y"])).resolves.toEqual({ result: "counted" });
    expect(n).toBe(3);
    // A Postgres-reported error leaves the socket healthy → back to the pool
    expect(clients.every((c) => c.release.mock.calls[0]?.[0] === undefined)).toBe(true);
  });

  it("gives up after 4 tries and lets the route answer 503", async () => {
    vi.spyOn(pool, "connect").mockImplementation((async () => fakeClient(() => pgError("40P01", "deadlock detected")).client) as typeof pool.connect);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(callFn("set_award_status", [1, "closed"])).rejects.toThrow("deadlock detected");
    expect(pool.connect).toHaveBeenCalledTimes(4);
  });

  it("a broken socket is destroyed, and a non-idempotent call is not sent twice", async () => {
    const c = fakeClient(() => socketError());
    vi.spyOn(pool, "connect").mockImplementation((async () => c.client) as typeof pool.connect);
    await expect(callFn("extend_award", [1, 30], "rolled-back")).rejects.toThrow("ECONNRESET");
    expect(c.client.query).toHaveBeenCalledTimes(1);
    expect(c.release.mock.calls[0][0]).toBeInstanceOf(Error);
  });

  it("no socket from the pool (connect timeout) is always safe to retry", async () => {
    let n = 0;
    vi.spyOn(pool, "connect").mockImplementation((async () => {
      if (++n === 1) throw new Error("timeout exceeded when trying to connect");
      return fakeClient(() => ({ ok: true })).client;
    }) as typeof pool.connect);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(callFn("extend_award", [1, 30], "rolled-back")).resolves.toEqual({ ok: true });
  });

  it("still talks to the real dev DB", async () => {
    await expect(callFn<{ awards: unknown[] }>("event_state")).resolves.toHaveProperty("awards");
  });
});
