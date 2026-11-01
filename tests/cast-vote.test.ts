// cast_vote + state machine against the Neon dev branch. Every test runs inside a
// transaction that is rolled back, so the shared dev data is never changed.
import { createHmac, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import { pgUrl } from "@/db/pg-url";
import type { TallySnapshot, VoteResult } from "@/lib/types";

const db = new Client({ connectionString: pgUrl(process.env.DATABASE_URL_UNPOOLED) });
const AWARD = 1;

const hash = (device: string) => createHmac("sha256", "test-salt").update(device).digest();

async function vote(nominee: number, device: string, requestId: string, award = AWARD) {
  const { rows } = await db.query("select cast_vote($1, $2, $3, $4) as r", [award, nominee, hash(device), requestId]);
  return rows[0].r as VoteResult;
}

async function snapshot(award = AWARD) {
  const { rows } = await db.query("select award_snapshot($1) as r", [award]);
  return rows[0].r as TallySnapshot;
}

const votesOf = (s: TallySnapshot, nominee: number) => s.counts.find(([id]) => id === nominee)?.[1] ?? 0;

async function setStatus(status: string, seconds: number | null = null, award = AWARD) {
  const { rows } = await db.query("select set_award_status($1, $2, $3) as r", [award, status, seconds]);
  return rows[0].r as { ok: boolean; error?: string };
}

beforeAll(() => db.connect());
afterAll(() => db.end());
beforeEach(async () => {
  await db.query("begin");
  // Known starting point inside the transaction: everything pending
  await db.query("update awards set status = 'pending', auto_close_at = null");
});
afterEach(() => db.query("rollback"));

describe("cast_vote", () => {
  it("counts a first vote and returns the full snapshot with a higher seq", async () => {
    await setStatus("open");
    const before = await snapshot();
    const r = await vote(5, randomUUID(), randomUUID());
    expect(r.result).toBe("counted");
    if (r.result !== "counted" || !r.snapshot) throw new Error("expected snapshot");
    expect(r.snapshot.seq).toBe(before.seq + 1);
    expect(votesOf(r.snapshot, 5)).toBe(votesOf(before, 5) + 1);
    expect(r.snapshot.total).toBe(before.total + 1);
    expect(r.snapshot.counts).toHaveLength(29);
  });

  it("rejects a second vote from the same device (different request) as already_voted", async () => {
    await setStatus("open");
    const device = randomUUID();
    await vote(5, device, randomUUID());
    const mid = await snapshot();
    const r = await vote(6, device, randomUUID());
    expect(r.result).toBe("already_voted");
    const after = await snapshot();
    expect(after.total).toBe(mid.total);
    expect(after.seq).toBe(mid.seq);
  });

  it("answers counted for a retry of the same request without counting it again", async () => {
    await setStatus("open");
    const device = randomUUID();
    const req = randomUUID();
    await vote(7, device, req);
    const mid = await snapshot();
    const r = await vote(7, device, req);
    expect(r).toEqual({ result: "counted", replay: true });
    expect((await snapshot()).total).toBe(mid.total);
  });

  it("still answers counted for a retry after voting has closed", async () => {
    await setStatus("open");
    const device = randomUUID();
    const req = randomUUID();
    await vote(7, device, req);
    await setStatus("closed");
    expect((await vote(7, device, req)).result).toBe("counted");
  });

  it("returns not_open while the award is pending", async () => {
    const r = await vote(5, randomUUID(), randomUUID());
    expect(r).toEqual({ result: "not_open", status: "pending" });
  });

  it("returns not_open after the award is closed", async () => {
    await setStatus("open");
    await setStatus("closed");
    expect(await vote(5, randomUUID(), randomUUID())).toEqual({ result: "not_open", status: "closed" });
  });

  it("returns not_open (closed) once the countdown has run out, before anyone expires it", async () => {
    await setStatus("open", 60);
    await db.query("update awards set auto_close_at = now() - interval '1 second' where id = $1", [AWARD]);
    expect(await vote(5, randomUUID(), randomUUID())).toEqual({ result: "not_open", status: "closed" });
  });

  it("returns invalid_nominee for an inactive or unknown nominee", async () => {
    await setStatus("open");
    await db.query("update nominees set active = false where id = 9");
    expect((await vote(9, randomUUID(), randomUUID())).result).toBe("invalid_nominee");
    expect((await vote(99, randomUUID(), randomUUID())).result).toBe("invalid_nominee");
  });

  it("returns not_open for an award that does not exist", async () => {
    expect((await vote(5, randomUUID(), randomUUID(), 42)).result).toBe("not_open");
  });

  it("keeps verify_tallies true: every ballot is exactly one vote", async () => {
    await setStatus("open");
    for (let i = 0; i < 10; i++) await vote((i % 29) + 1, randomUUID(), randomUUID());
    await vote(1, "same-device", randomUUID());
    await vote(2, "same-device", randomUUID());
    const { rows } = await db.query("select verify_tallies($1) as ok", [AWARD]);
    expect(rows[0].ok).toBe(true);
  });

  it("stores no nominee and no time next to the device", async () => {
    const { rows } = await db.query(
      "select column_name from information_schema.columns where table_name = 'ballots' order by 1",
    );
    expect(rows.map((r) => r.column_name)).toEqual(["award_id", "device_hash", "request_id"]);
  });
});

describe("tie-break", () => {
  // Nominees are numbered so that "first to the score" is never just the lower number
  const cast = async (plan: number[]) => {
    for (const n of plan) await vote(n, randomUUID(), randomUUID());
  };

  it("A reaches 5 before B: A ranks first, whatever the numbers", async () => {
    await db.query("update tallies set votes = 0, last_vote_at = null where award_id = $1", [AWARD]);
    await setStatus("open");
    await cast([18, 25, 25, 25, 25, 25, 18, 18, 18, 18, 7]);
    const s = await snapshot();
    expect(votesOf(s, 18)).toBe(5);
    expect(votesOf(s, 25)).toBe(5);
    expect(s.order.slice(0, 3)).toEqual([25, 18, 7]);
    expect(s.order).toHaveLength(29);
  });

  it("all tied: the order follows who reached the score first, and zero votes rank by number", async () => {
    await db.query("update tallies set votes = 0, last_vote_at = null where award_id = $1", [AWARD]);
    await setStatus("open");
    await cast([9, 3, 21]);
    const s = await snapshot();
    expect(s.order.slice(0, 5)).toEqual([9, 3, 21, 1, 2]);
  });

  it("rows counted before the migration (no time) stay usable and rank after timed ones", async () => {
    await db.query("update tallies set votes = 0, last_vote_at = null where award_id = $1", [AWARD]);
    await db.query("update tallies set votes = 2 where award_id = $1 and nominee_id in (4, 2)", [AWARD]);
    await setStatus("open");
    await cast([12, 12]);
    const s = await snapshot();
    expect(s.order.slice(0, 3)).toEqual([12, 2, 4]);
  });

  it("a reset wipes the times, so the next round starts level", async () => {
    await setStatus("open");
    await cast([28]);
    await setStatus("closed");
    await db.query("select reset_award($1)", [AWARD]);
    const { rows } = await db.query("select count(*)::int n from tallies where award_id = $1 and last_vote_at is not null", [AWARD]);
    expect(rows[0].n).toBe(0);
  });

  it("no time ever leaves Postgres, and ballots still has no nominee or time", async () => {
    await setStatus("open");
    const r = await vote(5, randomUUID(), randomUUID());
    expect(JSON.stringify(r)).not.toMatch(/last_vote|\d{4}-\d{2}-\d{2}T/);
    const { rows } = await db.query(
      "select column_name c from information_schema.columns where table_name = 'ballots' order by 1",
    );
    expect(rows.map((x) => x.c)).toEqual(["award_id", "device_hash", "request_id"]);
    const t = await db.query("select column_name c from information_schema.columns where table_name = 'tallies'");
    expect(t.rows.map((x) => x.c).sort()).toEqual(["award_id", "last_vote_at", "nominee_id", "votes"]);
  });
});

describe("set_award_status / expire_awards", () => {
  it("allows only one open award at a time", async () => {
    expect((await setStatus("open", null, 1)).ok).toBe(true);
    expect(await setStatus("open", null, 2)).toMatchObject({ ok: false, error: "another_open" });
  });

  it("rejects transitions outside the state machine", async () => {
    expect(await setStatus("revealed")).toMatchObject({ ok: false, error: "bad_transition" });
  });

  it("closes an overdue award and bumps the event version", async () => {
    await setStatus("open", 60);
    await db.query("update awards set auto_close_at = now() - interval '1 second' where id = $1", [AWARD]);
    const v0 = (await db.query("select version from events where id = 1")).rows[0].version;
    const { rows } = await db.query("select expire_awards() as ids");
    expect(rows[0].ids).toEqual([AWARD]);
    expect((await snapshot()).status).toBe("closed");
    const v1 = (await db.query("select version from events where id = 1")).rows[0].version;
    expect(Number(v1)).toBe(Number(v0) + 1);
    // Idempotent
    expect((await db.query("select expire_awards() as ids")).rows[0].ids).toEqual([]);
  });

  it("reset_award clears ballots, zeroes the board and bumps round", async () => {
    await setStatus("open");
    const device = randomUUID();
    await vote(3, device, randomUUID());
    await setStatus("closed");
    const before = await snapshot();
    const { rows } = await db.query("select reset_award($1) as r", [AWARD]);
    expect(rows[0].r.ok).toBe(true);
    const after = await snapshot();
    expect(after.total).toBe(0);
    expect(after.round).toBe(before.round + 1);
    expect(after.status).toBe("pending");
    await setStatus("open");
    expect((await vote(3, device, randomUUID())).result).toBe("counted");
  });
});
