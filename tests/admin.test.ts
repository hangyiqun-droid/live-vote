// M3: MC session + the new state functions, against the Neon dev branch in rolled-back transactions
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import { pgUrl } from "@/db/pg-url";
import { isValidSession, makeSession, passcodeMatches } from "@/lib/server/admin-session";
import { parseAction } from "@/lib/server/admin";
import type { AdminOverview, EventState } from "@/lib/types";

describe("admin session", () => {
  it("accepts the right passcode only", () => {
    expect(passcodeMatches(process.env.ADMIN_PASSCODE)).toBe(true);
    expect(passcodeMatches(`${process.env.ADMIN_PASSCODE}x`)).toBe(false);
    expect(passcodeMatches("")).toBe(false);
    expect(passcodeMatches(undefined)).toBe(false);
  });

  it("signs a 12 h cookie and rejects tampered or expired ones", () => {
    const now = Date.now();
    const v = makeSession(now);
    expect(isValidSession(v, now + 1000)).toBe(true);
    expect(isValidSession(v, now + 12 * 3600_000 + 1)).toBe(false);
    const [exp, sig] = v.split(".");
    expect(isValidSession(`${Number(exp) + 1}.${sig}`, now)).toBe(false);
    expect(isValidSession(`${exp}.${sig.slice(1)}x`, now)).toBe(false);
    expect(isValidSession(undefined, now)).toBe(false);
  });
});

describe("parseAction", () => {
  it("only lets the MC's timer choices through", () => {
    expect(parseAction({ action: "open", award_id: 1, seconds: 90 })).toEqual({ action: "open", award_id: 1, seconds: 90 });
    expect(parseAction({ action: "open", award_id: 1, seconds: 45 })).toBeNull();
    expect(parseAction({ action: "close" })).toBeNull();
    expect(parseAction({ action: "drop_table" })).toBeNull();
    expect(parseAction({ action: "hide", on: "yes" })).toBeNull();
  });
});

const db = new Client({ connectionString: pgUrl(process.env.DATABASE_URL_UNPOOLED) });
const fn = async <T,>(sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows[0].r as T;
const state = () => fn<EventState>("select event_state() as r");

describe("M3 state functions", () => {
  beforeAll(() => db.connect());
  afterAll(() => db.end());
  beforeEach(async () => {
    await db.query("begin");
    await db.query("update awards set status = 'pending', auto_close_at = null");
    await db.query("update events set current_award_id = null, show_hall = false, qr_fallback = false");
  });
  afterEach(() => db.query("rollback"));

  it("walks pending → open → closed → revealed → closed → revealed, putting the award on screen", async () => {
    for (const [to, ok] of [["open", true], ["closed", true], ["revealed", true], ["closed", true], ["revealed", true], ["pending", false]] as const) {
      const r = await fn<{ ok: boolean }>("select set_award_status(2::smallint, $1::award_status) as r", [to]);
      expect(r.ok, to).toBe(ok);
    }
    const s = await state();
    expect(s.current_award_id).toBe(2);
    expect(s.awards.find((a) => a.id === 2)?.status).toBe("revealed");
  });

  it("hall on/off, and showing an award or revealing takes the hall down", async () => {
    await fn("select set_show_hall(true) as r");
    expect((await state()).show_hall).toBe(true);
    await fn("select set_current_award(3::smallint) as r");
    expect((await state()).show_hall).toBe(false);
    await fn("select set_show_hall(true) as r");
    await fn("select set_award_status(3::smallint, 'open'::award_status) as r");
    expect((await state()).show_hall).toBe(false);
  });

  it("backup QR flag round-trips and phones' state has no counts", async () => {
    await fn("select set_qr_fallback(true) as r");
    const s = await state();
    expect(s.qr_fallback).toBe(true);
    expect(JSON.stringify(s)).not.toMatch(/"(counts|votes|total)"/);
  });

  it("renames an award and refuses empty or too long titles", async () => {
    expect((await fn<{ ok: boolean }>("select set_award_title(1::smallint, $1, $2) as r", ["  ขวัญใจรุ่น  ", ""])).ok).toBe(true);
    const a = (await state()).awards.find((x) => x.id === 1)!;
    expect(a.title).toBe("ขวัญใจรุ่น");
    expect(a.subtitle).toBeNull();
    expect((await fn<{ error: string }>("select set_award_title(1::smallint, $1, null) as r", ["   "])).error).toBe("bad_title");
    expect((await fn<{ error: string }>("select set_award_title(1::smallint, $1, null) as r", ["ก".repeat(81)])).error).toBe("bad_title");
  });

  it("admin_overview has all 5 tallies with the ballot check", async () => {
    const o = await fn<AdminOverview>("select admin_overview() as r");
    expect(o.tallies).toHaveLength(5);
    expect(o.tallies.every((t) => t.counts.length === 29 && typeof t.verified === "boolean")).toBe(true);
    expect(o.state.awards).toHaveLength(5);
  });

  it("only one award open at a time", async () => {
    await fn("select set_award_status(1::smallint, 'open'::award_status) as r");
    expect((await fn<{ error: string }>("select set_award_status(2::smallint, 'open'::award_status) as r")).error).toBe("another_open");
  });
});
