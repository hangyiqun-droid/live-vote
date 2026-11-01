// DEMO_MODE=1: greetings stay off, and the daily reset cron is guarded by CRON_SECRET and exists only in demo mode.
// The reset test commits to the test database (it has to: the route runs its own connections) and leaves it fresh.
import { createHmac, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// Route handlers run outside a request here, so `connection()` (which makes the route dynamic) is a no-op
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), connection: async () => undefined }));

import { callFn } from "@/db/client";
import { seedAwards } from "@/data/awards";
import { GET } from "@/app/api/cron/reset-demo/route";
import { runAdminAction } from "@/lib/server/admin";
import { resetDemo } from "@/lib/server/demo-reset";
import { sendGreeting } from "@/lib/server/lobby";
import { readEventState, withDemo } from "@/lib/server/state";
import type { EventState, TallySnapshot } from "@/lib/types";

const SECRET = "test-cron-secret";
const call = (authorization?: string) =>
  GET(new NextRequest("http://localhost/api/cron/reset-demo", { headers: authorization ? { authorization } : {} }));

afterEach(() => vi.unstubAllEnvs());

describe("withDemo", () => {
  const base = { greetings_on: true, awards: [] } as unknown as EventState;

  it("changes nothing outside demo mode", () => {
    vi.stubEnv("DEMO_MODE", "");
    expect(withDemo(base)).toBe(base);
    vi.stubEnv("DEMO_MODE", "true"); // only the exact value 1 turns it on
    expect(withDemo(base)).toBe(base);
  });

  it("marks the state as demo and forces greetings off, whatever the MC switch says", () => {
    vi.stubEnv("DEMO_MODE", "1");
    const s = withDemo(base);
    expect(s.demo).toBe(true);
    expect(s.greetings_on).toBe(false);
  });
});

describe("greetings in demo mode", () => {
  it("are refused on the server before anything is checked or sent", async () => {
    vi.stubEnv("DEMO_MODE", "1");
    expect(await sendGreeting(randomUUID(), randomUUID(), "สวัสดี")).toEqual({ result: "closed" });
  });

  it("the MC switch cannot turn them back on", async () => {
    vi.stubEnv("DEMO_MODE", "1");
    expect(await runAdminAction({ action: "greetings", on: true })).toEqual({ ok: false, error: "demo_mode" });
  });
});

describe("GET /api/cron/reset-demo", () => {
  it("is a 404 when DEMO_MODE is not on, even with the right secret", async () => {
    vi.stubEnv("DEMO_MODE", "");
    vi.stubEnv("CRON_SECRET", SECRET);
    expect((await call(`Bearer ${SECRET}`)).status).toBe(404);
  });

  it("is a 401 without the secret, with a wrong one, or when no secret is configured", async () => {
    vi.stubEnv("DEMO_MODE", "1");
    vi.stubEnv("CRON_SECRET", SECRET);
    expect((await call()).status).toBe(401);
    expect((await call("Bearer nope")).status).toBe(401);
    expect((await call(SECRET)).status).toBe(401); // no "Bearer"
    vi.stubEnv("CRON_SECRET", "");
    expect((await call("Bearer ")).status).toBe(401);
  });

  it("puts every award back to pending and empty, restores the names and returns to the lobby", async () => {
    vi.stubEnv("DEMO_MODE", "1");
    vi.stubEnv("CRON_SECRET", SECRET);
    const hash = (d: string) => createHmac("sha256", "test-salt").update(d).digest();
    await resetDemo(); // known starting point in the shared test database

    // Make a mess: award 1 voted and revealed, award 2 open with a vote, award 3 renamed, hall + hide on
    expect((await runAdminAction({ action: "open", award_id: 1, seconds: 0 })).ok).toBe(true);
    await callFn("cast_vote", [1, 5, hash(randomUUID()), randomUUID()]);
    expect((await runAdminAction({ action: "close", award_id: 1 })).ok).toBe(true);
    expect((await runAdminAction({ action: "reveal", award_id: 1 })).ok).toBe(true);
    expect((await runAdminAction({ action: "open", award_id: 2, seconds: 0 })).ok).toBe(true);
    await callFn("cast_vote", [2, 6, hash(randomUUID()), randomUUID()]);
    expect((await runAdminAction({ action: "rename", award_id: 3, title: "Renamed by a visitor", subtitle: "" })).ok).toBe(true);
    expect((await runAdminAction({ action: "hide", on: true })).ok).toBe(true);
    expect((await runAdminAction({ action: "hall", on: true })).ok).toBe(true);
    const messy = await readEventState();
    expect(messy.awards.find((a) => a.id === 2)!.status).toBe("open");

    const res = await call(`Bearer ${SECRET}`);
    expect(await res.json()).toMatchObject({ ok: true, failed: [] });
    expect(res.status).toBe(200);

    const after = await readEventState();
    expect(after.current_award_id).toBeNull();
    expect(after.hide_counts).toBe(false);
    expect(after.show_hall).toBe(false);
    expect(after.demo).toBe(true);
    for (const a of after.awards) {
      expect(a.status).toBe("pending");
      expect(a.title).toBe(seedAwards.find((s) => s.id === a.id)!.title);
      expect(a.round).toBeGreaterThanOrEqual(messy.awards.find((m) => m.id === a.id)!.round);
      const snap = await callFn<TallySnapshot>("award_snapshot", [a.id]);
      expect(snap.total).toBe(0);
    }
    expect(after.awards.find((a) => a.id === 1)!.round).toBeGreaterThan(messy.awards.find((m) => m.id === 1)!.round);
  });
});
