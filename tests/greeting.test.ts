// fix9: lobby counter + greetings against the Neon dev branch and the Ably dev app.
// Function-level cases run in rolled-back transactions; the end-to-end ones use random devices and
// clean up after themselves.
import * as Ably from "ably";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import { pgUrl } from "@/db/pg-url";
import { pool } from "@/db/client";
import { deviceHash, scanHash } from "@/lib/server/device";
import { parseAction } from "@/lib/server/admin";
import { sendGreeting } from "@/lib/server/lobby";
import { CHANNEL_LOBBY, GREETING_GAP_SECONDS, type EventState, type GreetingBatch } from "@/lib/types";
import { randomUUID } from "node:crypto";

const db = new Client({ connectionString: pgUrl(process.env.DATABASE_URL_UNPOOLED) });
const fn = async <T,>(sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows[0].r as T;
const hash = () => scanHash(randomUUID());

describe("scan hash", () => {
  it("is not the ballot hash, so scanned_devices can never be joined to ballots", () => {
    const id = randomUUID();
    expect(scanHash(id).equals(deviceHash(id))).toBe(false);
    expect(scanHash(id).equals(scanHash(id))).toBe(true);
    expect(scanHash(id).length).toBe(32);
  });
});

describe("parseAction (fix9)", () => {
  it("knows the greetings switch and the counter reset, nothing sneaky", () => {
    expect(parseAction({ action: "greetings", on: false })).toEqual({ action: "greetings", on: false });
    expect(parseAction({ action: "greetings", on: "no" })).toBeNull();
    expect(parseAction({ action: "reset_scans" })).toEqual({ action: "reset_scans" });
  });
});

describe("lobby functions (rolled back)", () => {
  beforeAll(() => db.connect());
  afterAll(() => db.end());
  beforeEach(async () => {
    await db.query("begin");
    await db.query("delete from scanned_devices");
    await db.query("update events set current_award_id = null, show_hall = false, greetings_on = true");
  });
  afterEach(() => db.query("rollback"));

  it("counts a device once, however often it opens the page", async () => {
    const a = hash();
    const first = await fn<{ new: boolean; count: number; at: number }>("select register_scan($1) as r", [a]);
    const again = await fn<{ new: boolean; count: number }>("select register_scan($1) as r", [a]);
    const other = await fn<{ new: boolean; count: number }>("select register_scan($1) as r", [hash()]);
    expect(first).toMatchObject({ new: true, count: 1 });
    expect(again).toMatchObject({ new: false, count: 1 });
    expect(other).toMatchObject({ new: true, count: 2 });
    expect(typeof first.at).toBe("number");
    expect((await fn<{ count: number }>("select scan_count() as r")).count).toBe(2);
  });

  it("the MC can clear the counter; the same phone is counted again afterwards", async () => {
    const a = hash();
    await fn("select register_scan($1) as r", [a]);
    const cleared = await fn<{ ok: boolean; count: number }>("select reset_scans() as r");
    expect(cleared).toMatchObject({ ok: true, count: 0 });
    expect(await fn("select register_scan($1) as r", [a])).toMatchObject({ new: true, count: 1 });
  });

  it("the greeting gate lets one through per device per gap, then says how long to wait", async () => {
    const a = hash();
    expect(await fn("select greeting_gate($1, 10) as r", [a])).toEqual({ result: "ok" });
    const soon = await fn<{ result: string; retry_after: number }>("select greeting_gate($1, 10) as r", [a]);
    expect(soon.result).toBe("too_soon");
    expect(soon.retry_after).toBeGreaterThanOrEqual(1);
    expect(soon.retry_after).toBeLessThanOrEqual(10);
    // another phone is not held back by the first one
    expect(await fn("select greeting_gate($1, 10) as r", [hash()])).toEqual({ result: "ok" });
    // the gap is over: send again
    await db.query("update scanned_devices set last_greet_at = clock_timestamp() - interval '11 seconds' where device_hash = $1", [a]);
    expect(await fn("select greeting_gate($1, 10) as r", [a])).toEqual({ result: "ok" });
  });

  it("the gate is closed when the switch is off, when an award is on screen, and when the hall is up", async () => {
    await fn("select set_greetings(false) as r");
    expect(await fn("select greeting_gate($1, 10) as r", [hash()])).toEqual({ result: "closed" });
    expect((await fn<EventState>("select event_state() as r")).greetings_on).toBe(false);
    await fn("select set_greetings(true) as r");
    expect(await fn("select greeting_gate($1, 10) as r", [hash()])).toEqual({ result: "ok" });
    await fn("select set_current_award(1::smallint) as r");
    expect(await fn("select greeting_gate($1, 10) as r", [hash()])).toEqual({ result: "closed" });
    await fn("select set_current_award(null) as r");
    await fn("select set_show_hall(true) as r");
    expect(await fn("select greeting_gate($1, 10) as r", [hash()])).toEqual({ result: "closed" });
  });

  it("the switch bumps the event version so phones and the stage hear it, and is on by default", async () => {
    const before = (await fn<EventState>("select event_state() as r")).version;
    await fn("select set_greetings(false) as r");
    const after = await fn<EventState>("select event_state() as r");
    expect(after.version).toBeGreaterThan(before);
    expect(after.greetings_on).toBe(false);
    const col = await db.query("select column_default from information_schema.columns where table_name = 'events' and column_name = 'greetings_on'");
    expect(col.rows[0].column_default).toBe("true");
  });

  it("nothing in the database can hold a greeting or tie a device to a vote", async () => {
    const cols = (
      await db.query("select table_name, column_name from information_schema.columns where table_schema = 'public' order by 1, 2")
    ).rows.map((r) => `${r.table_name}.${r.column_name}`);
    expect(cols.filter((c) => c.startsWith("scanned_devices."))).toEqual(["scanned_devices.device_hash", "scanned_devices.last_greet_at"]);
    expect(cols.filter((c) => /greet|message|text|body/.test(c) && !c.startsWith("awards.") && !c.startsWith("events.title"))).toEqual([
      "scanned_devices.last_greet_at",
      "events.greetings_on",
    ].sort());
  });
});

describe("sendGreeting end to end (Ably dev app)", () => {
  const sub = new Ably.Realtime({ key: process.env.ABLY_API_KEY!, logLevel: 0 } as Ably.ClientOptions);
  const seen: string[] = [];
  const devices: string[] = [];
  const dev = () => (devices.push(randomUUID()), devices.at(-1)!);
  let wasOn = true;

  beforeAll(async () => {
    await db.connect().catch(() => undefined);
    await sub.channels.get(CHANNEL_LOBBY).subscribe("greet", (m) => {
      for (const x of (m.data as GreetingBatch).items) seen.push(x.text);
    });
    const r = await pool.query("select greetings_on, current_award_id, show_hall from events where id = 1");
    wasOn = r.rows[0].greetings_on;
    await pool.query("update events set greetings_on = true, current_award_id = null, show_hall = false");
  });
  afterAll(async () => {
    await pool.query("update events set greetings_on = $1", [wasOn]);
    for (const d of devices) await pool.query("delete from scanned_devices where device_hash = $1", [scanHash(d)]);
    sub.close();
    await pool.end();
  });

  const arrived = async (text: string) => {
    const until = Date.now() + 5_000;
    while (!seen.includes(text) && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
    return seen.includes(text);
  };

  it("a clean greeting reaches the lobby channel; a second one within 10 s is turned away", async () => {
    const d = dev();
    const text = `ทดสอบ ${randomUUID().slice(0, 8)}`;
    expect(await sendGreeting(d, randomUUID(), text)).toEqual({ result: "sent" });
    expect(await arrived(text)).toBe(true);

    const second = `อีกข้อความ ${randomUUID().slice(0, 8)}`;
    const r = await sendGreeting(d, randomUUID(), second);
    expect(r.result).toBe("too_soon");
    expect((r as { retry_after: number }).retry_after).toBeLessThanOrEqual(GREETING_GAP_SECONDS);
    await new Promise((res) => setTimeout(res, 400));
    expect(seen).not.toContain(second);
  });

  it("a retry of the same request is answered 'sent' without a second message", async () => {
    const d = dev();
    const id = randomUUID();
    const text = `ซ้ำ ${randomUUID().slice(0, 8)}`;
    expect(await sendGreeting(d, id, text)).toEqual({ result: "sent" });
    expect(await sendGreeting(d, id, text)).toEqual({ result: "sent" });
    await arrived(text);
    expect(seen.filter((t) => t === text)).toHaveLength(1);
  });

  it("too long, empty and swear words are refused before the sender's slot is used", async () => {
    const d = dev();
    expect((await sendGreeting(d, randomUUID(), "ก".repeat(61))).result).toBe("too_long");
    expect((await sendGreeting(d, randomUUID(), "   ")).result).toBe("empty");
    expect((await sendGreeting(d, randomUUID(), "ไอ้เหี้ย")).result).toBe("blocked");
    expect((await sendGreeting(d, randomUUID(), "fuck")).result).toBe("blocked");
    // none of that used the slot: a clean one still goes through
    expect((await sendGreeting(d, randomUUID(), `ผ่านแล้ว ${randomUUID().slice(0, 6)}`)).result).toBe("sent");
  });

  it("with the switch off nothing is published, and the greeting is not kept anywhere", async () => {
    await pool.query("update events set greetings_on = false");
    const text = `ห้ามขึ้น ${randomUUID().slice(0, 8)}`;
    expect(await sendGreeting(dev(), randomUUID(), text)).toEqual({ result: "closed" });
    await new Promise((res) => setTimeout(res, 500));
    expect(seen).not.toContain(text);
    await pool.query("update events set greetings_on = true");

    // the text of a greeting that did go out is in no table either
    const sentText = `ไม่เก็บ ${randomUUID().slice(0, 8)}`;
    expect(await sendGreeting(dev(), randomUUID(), sentText)).toEqual({ result: "sent" });
    await arrived(sentText);
    const tables = (await pool.query("select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'")).rows.map((r) => r.table_name as string);
    for (const t of tables) {
      const hit = await pool.query(`select 1 from "${t}" as x where x::text like $1`, [`%${sentText}%`]);
      expect(hit.rowCount, t).toBe(0);
    }
  });
});
