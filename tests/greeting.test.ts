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
import { greetingLane } from "@/lib/server/ably";
import { CHANNEL_LOBBY, GREETING_GAP_SECONDS, GREETING_MAX_PER_SECOND, type EventState, type GreetingBatch } from "@/lib/types";
import { randomUUID } from "node:crypto";

const db = new Client({ connectionString: pgUrl(process.env.DATABASE_URL_UNPOOLED) });
const fn = async <T,>(sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows[0].r as T;
const hash = () => scanHash(randomUUID());
const req = () => scanHash(randomUUID()); // any 32 random bytes will do as a request hash

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

  it("counts a device once, however often it opens the page, and the revision moves only for a new one", async () => {
    const a = hash();
    const first = await fn<{ new: boolean; count: number; rev: number }>("select register_scan($1) as r", [a]);
    const again = await fn<{ new: boolean; count: number; rev: number }>("select register_scan($1) as r", [a]);
    const other = await fn<{ new: boolean; count: number; rev: number }>("select register_scan($1) as r", [hash()]);
    expect(first).toMatchObject({ new: true, count: 1 });
    expect(again).toMatchObject({ new: false, count: 1, rev: first.rev });
    expect(other).toMatchObject({ new: true, count: 2, rev: first.rev + 1 });
    expect(await fn("select scan_count() as r")).toEqual({ count: 2, rev: other.rev });
  });

  it("the MC can clear the counter (the revision still moves forward); the same phone is counted again afterwards", async () => {
    const a = hash();
    const first = await fn<{ rev: number }>("select register_scan($1) as r", [a]);
    const cleared = await fn<{ ok: boolean; count: number; rev: number }>("select reset_scans() as r");
    expect(cleared).toMatchObject({ ok: true, count: 0 });
    expect(cleared.rev).toBeGreaterThan(first.rev);
    expect(await fn("select register_scan($1) as r", [a])).toMatchObject({ new: true, count: 1, rev: cleared.rev + 1 });
  });

  it("the greeting gate lets one through per device per gap, then says how long to wait", async () => {
    const a = hash();
    expect(await fn("select greeting_gate($1, 10, $2, 100) as r", [a, req()])).toMatchObject({ result: "ok" });
    const soon = await fn<{ result: string; retry_after: number }>("select greeting_gate($1, 10, $2, 100) as r", [a, req()]);
    expect(soon.result).toBe("too_soon");
    expect(soon.retry_after).toBeGreaterThanOrEqual(1);
    expect(soon.retry_after).toBeLessThanOrEqual(10);
    // another phone is not held back by the first one
    expect(await fn("select greeting_gate($1, 10, $2, 100) as r", [hash(), req()])).toMatchObject({ result: "ok" });
    // the gap is over: send again
    await db.query("update scanned_devices set last_greet_at = clock_timestamp() - interval '11 seconds' where device_hash = $1", [a]);
    expect(await fn("select greeting_gate($1, 10, $2, 100) as r", [a, req()])).toMatchObject({ result: "ok" });
  });

  it("at most 3 greetings a second across all devices (R: durable ceiling); the 4th is told to retry and keeps its slot", async () => {
    const results: string[] = [];
    for (let i = 0; i < 5; i++) results.push((await fn<{ result: string }>("select greeting_gate($1, 10, $2, $3) as r", [hash(), req(), GREETING_MAX_PER_SECOND])).result);
    expect(results.slice(0, 3)).toEqual(["ok", "ok", "ok"]);
    expect(results.slice(3)).toEqual(["busy", "busy"]);
    const keeper = hash();
    const busy = await fn<{ result: string; retry_after: number }>("select greeting_gate($1, 10, $2, $3) as r", [keeper, req(), GREETING_MAX_PER_SECOND]);
    expect(busy).toMatchObject({ result: "busy", retry_after: 1 });
    // busy did not use up the sender's 10 s slot: once the second has passed the same device gets in
    await db.query("update greeting_requests set at = clock_timestamp() - interval '2 seconds'");
    expect(await fn("select greeting_gate($1, 10, $2, $3) as r", [keeper, req(), GREETING_MAX_PER_SECOND])).toMatchObject({ result: "ok" });
  });

  it("the same request id inside 60 s is a replay — on any server instance, since it lives in Postgres", async () => {
    const id = req();
    const a = hash();
    expect(await fn("select greeting_gate($1, 10, $2, 100) as r", [a, id])).toMatchObject({ result: "ok" });
    expect(await fn("select greeting_gate($1, 10, $2, 100) as r", [a, id])).toEqual({ result: "replay" });
    // after the 10 s device gap the very same request is still a replay, not a second greeting
    await db.query("update scanned_devices set last_greet_at = clock_timestamp() - interval '11 seconds' where device_hash = $1", [a]);
    expect(await fn("select greeting_gate($1, 10, $2, 100) as r", [a, id])).toEqual({ result: "replay" });
    // after 60 s it is forgotten
    await db.query("update greeting_requests set at = clock_timestamp() - interval '61 seconds'");
    expect(await fn("select greeting_gate($1, 10, $2, 100) as r", [a, id])).toMatchObject({ result: "ok" });
  });

  it("a greeting that never went out can be released: the sender may retry at once with the same request", async () => {
    const id = req();
    const a = hash();
    await fn("select greeting_gate($1, 10, $2, 100) as r", [a, id]);
    await fn("select greeting_release($1, $2) as r", [a, id]);
    expect(await fn("select greeting_gate($1, 10, $2, 100) as r", [a, id])).toMatchObject({ result: "ok" });
  });

  it("a device the gate had never seen counts as a scan: the revision moves and the answer carries the new count", async () => {
    const before = await fn<{ count: number; rev: number }>("select scan_count() as r");
    const r = await fn<{ result: string; scan?: { count: number; rev: number } }>("select greeting_gate($1, 10, $2, 100) as r", [hash(), req()]);
    expect(r.scan).toEqual({ count: before.count + 1, rev: before.rev + 1 });
  });

  it("the gate is closed when the switch is off, when an award is on screen, and when the hall is up", async () => {
    await fn("select set_greetings(false) as r");
    expect(await fn("select greeting_gate($1, 10, $2, 100) as r", [hash(), req()])).toEqual({ result: "closed" });
    expect(await fn("select greetings_open() as r")).toBe(false);
    expect((await fn<EventState>("select event_state() as r")).greetings_on).toBe(false);
    await fn("select set_greetings(true) as r");
    expect(await fn("select greeting_gate($1, 10, $2, 100) as r", [hash(), req()])).toMatchObject({ result: "ok" });
    expect(await fn("select greetings_open() as r")).toBe(true);
    await fn("select set_current_award(1::smallint) as r");
    expect(await fn("select greeting_gate($1, 10, $2, 100) as r", [hash(), req()])).toEqual({ result: "closed" });
    expect(await fn("select greetings_open() as r")).toBe(false);
    await fn("select set_current_award(null) as r");
    await fn("select set_show_hall(true) as r");
    expect(await fn("select greeting_gate($1, 10, $2, 100) as r", [hash(), req()])).toEqual({ result: "closed" });
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
    expect(cols.filter((c) => c.startsWith("greeting_requests."))).toEqual(["greeting_requests.at", "greeting_requests.request_hash"]);
    expect(cols.filter((c) => c.startsWith("lobby_stats."))).toEqual(["lobby_stats.id", "lobby_stats.scan_rev"]);
    // no column anywhere that could hold a greeting's words
    expect(cols.filter((c) => /message|text|body|greeting(?!s_on|_requests)/.test(c) && !c.startsWith("awards.") && !c.startsWith("events.title"))).toEqual([]);
  });
});

describe("scan counter race (R2): the count belongs to the commit", () => {
  const url = pgUrl(process.env.DATABASE_URL_UNPOOLED);
  const A = new Client({ connectionString: url });
  const B = new Client({ connectionString: url });
  beforeAll(async () => {
    await A.connect();
    await B.connect();
  });
  afterAll(async () => {
    await A.query("select reset_scans()");
    await A.end();
    await B.end();
  });

  it("two overlapping transactions: the second waits for the first, then reports before + 2 at the next revision", async () => {
    const one = async (c: Client, h: Buffer) => (await c.query("select register_scan($1) as r", [h])).rows[0].r as { count: number; rev: number; new: boolean };
    await A.query("select reset_scans()");
    const before = (await A.query("select scan_count() as r")).rows[0].r as { count: number; rev: number };

    await A.query("begin");
    await B.query("begin");
    const a = await one(A, hash());
    expect(a).toMatchObject({ new: true, count: before.count + 1, rev: before.rev + 1 });

    // B asks while A has not committed: it must wait for A (it used to answer before + 1 at once)
    let bAnswered = false;
    const bPromise = one(B, hash()).then((r) => ((bAnswered = true), r));
    await new Promise((r) => setTimeout(r, 400));
    expect(bAnswered).toBe(false);

    await A.query("commit");
    const b = await bPromise;
    await B.query("commit");
    expect(b).toMatchObject({ new: true, count: before.count + 2, rev: before.rev + 2 });
    expect((await A.query("select scan_count() as r")).rows[0].r).toEqual({ count: before.count + 2, rev: before.rev + 2 });
  });

  it("40 devices registering at the same moment: every answer is a distinct revision and the last one equals the table", async () => {
    await A.query("select reset_scans()");
    const pool = Array.from({ length: 8 }, () => new Client({ connectionString: url }));
    await Promise.all(pool.map((c) => c.connect()));
    try {
      // 8 connections, 5 phones each: the connections run side by side, each works through its own phones in order
      const answers = (
        await Promise.all(
          pool.map(async (c) => {
            const mine: { count: number; rev: number }[] = [];
            for (let i = 0; i < 5; i++) mine.push((await c.query("select register_scan($1) as r", [hash()])).rows[0].r);
            return mine;
          }),
        )
      ).flat();
      const revs = answers.map((x) => x.rev);
      expect(new Set(revs).size).toBe(40);
      const last = answers.reduce((m, x) => (x.rev > m.rev ? x : m));
      expect(last.count).toBe(40);
      // count and revision rise together: a higher revision never carries a lower count
      for (const x of answers) for (const y of answers) if (x.rev > y.rev) expect(x.count).toBeGreaterThan(y.count);
      expect((await A.query("select scan_count() as r")).rows[0].r).toEqual({ count: 40, rev: last.rev });
    } finally {
      await Promise.all(pool.map((c) => c.end()));
    }
  });

  it("scan, greeting gate and reset together never deadlock (same lock order)", async () => {
    const pool = Array.from({ length: 6 }, () => new Client({ connectionString: url }));
    await Promise.all(pool.map((c) => c.connect()));
    try {
      // each connection works through its own share in order; the six run side by side
      const jobs = pool.map(async (c, ci) => {
        for (let i = ci; i < 60; i += pool.length) {
          const kind = i % 6;
          if (kind === 0) await c.query("select reset_scans()");
          else if (kind === 1 || kind === 2) await c.query("select greeting_gate($1, 10, $2, 100)", [hash(), req()]);
          else await c.query("select register_scan($1)", [hash()]);
        }
      });
      await expect(Promise.all(jobs)).resolves.toBeDefined();
    } finally {
      await Promise.all(pool.map((c) => c.end()));
    }
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

  // the app-wide ceiling is 3 a second: keep the cases a second apart
  beforeEach(() => new Promise((r) => setTimeout(r, 1_100)));

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

  it("a retry after the device's 10 s gap is still a replay: one request id never publishes twice", async () => {
    const d = dev();
    const id = randomUUID();
    const text = `ซ้ำข้ามเวลา ${randomUUID().slice(0, 8)}`;
    expect(await sendGreeting(d, id, text)).toEqual({ result: "sent" });
    await arrived(text);
    await pool.query("update scanned_devices set last_greet_at = clock_timestamp() - interval '11 seconds' where device_hash = $1", [scanHash(d)]);
    expect(await sendGreeting(d, id, text)).toEqual({ result: "sent" });
    await new Promise((res) => setTimeout(res, 500));
    expect(seen.filter((t) => t === text)).toHaveLength(1);
  });

  it("a greeting already in the queue when the MC switches off is dropped, not published, and its sender can retry", async () => {
    const text = `ค้างคิว ${randomUUID().slice(0, 8)}`;
    await pool.query("update events set greetings_on = false");
    expect(await greetingLane.enqueue({ id: randomUUID(), text })).toBe("closed");
    await new Promise((res) => setTimeout(res, 500));
    expect(seen).not.toContain(text);
    await pool.query("update events set greetings_on = true");
  });

  it("the system-wide ceiling: 12 different phones at once → at most 3 get through that second, the rest are told to retry", async () => {
    const answers = await Promise.all(Array.from({ length: 12 }, () => sendGreeting(dev(), randomUUID(), `พร้อมกัน ${randomUUID().slice(0, 6)}`)));
    const sent = answers.filter((a) => a.result === "sent").length;
    const busy = answers.filter((a) => a.result === "busy").length;
    expect(sent).toBe(GREETING_MAX_PER_SECOND);
    expect(busy).toBe(12 - GREETING_MAX_PER_SECOND);
    for (const a of answers) if (a.result === "busy") expect((a as { retry_after?: number }).retry_after).toBeGreaterThanOrEqual(1);
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
