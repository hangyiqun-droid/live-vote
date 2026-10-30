// fix3: every function that writes both events and awards locks events first, so an expired
// countdown closed by a reader can never deadlock with an MC action (fix2 report, 40P01).
// Two sessions are needed, so unlike the other DB tests this one commits on the Neon dev branch
// and puts award AWARD + events back the way it found them. No retries anywhere: a deadlock fails.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import { pgUrl } from "@/db/pg-url";

const AWARD = 5;
const ROUNDS = 25;
const url = pgUrl(process.env.DATABASE_URL_UNPOOLED);
const mk = () => new Client({ connectionString: url, application_name: "event-lock-order-test" });

const setup = mk();
const a = mk(); // the reader closing an expired countdown
const b = mk(); // the MC
const extra = [mk(), mk(), mk(), mk()];
let saved: Record<string, unknown>;
let savedEvent: Record<string, unknown>;

const codeOf = (e: unknown) => (e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : "");
const settle = async (p: Promise<unknown>) => p.then(() => null, (e) => codeOf(e) || String(e));

async function expiredOpen() {
  // Nothing else open (SPEC: one award at a time), this one open with a countdown that ran out
  await setup.query("update awards set status = 'closed', auto_close_at = null where status = 'open' and id <> $1", [AWARD]);
  await setup.query(
    "update awards set status = 'open', opened_at = now() - interval '1 minute', closed_at = null, revealed_at = null, auto_close_at = now() - interval '1 second' where id = $1",
    [AWARD],
  );
}

// Wait until `pid` is parked on a lock — the interleaving that used to deadlock
async function waitLocked(pid: number) {
  for (let i = 0; i < 100; i++) {
    const { rows } = await setup.query("select wait_event_type from pg_stat_activity where pid = $1", [pid]);
    if (rows[0]?.wait_event_type === "Lock") return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("session never blocked on a lock");
}

const pidOf = async (c: Client) => (await c.query("select pg_backend_pid() as p")).rows[0].p as number;

beforeAll(async () => {
  await Promise.all([setup, a, b, ...extra].map((c) => c.connect()));
  saved = (await setup.query("select status, opened_at, closed_at, revealed_at, auto_close_at, title, subtitle from awards where id = $1", [AWARD])).rows[0];
  savedEvent = (await setup.query("select current_award_id, show_hall from events where id = 1")).rows[0];
});

afterAll(async () => {
  await setup.query(
    "update awards set status = $2, opened_at = $3, closed_at = $4, revealed_at = $5, auto_close_at = $6, title = $7, subtitle = $8, seq = seq + 1 where id = $1",
    [AWARD, saved.status, saved.opened_at, saved.closed_at, saved.revealed_at, saved.auto_close_at, saved.title, saved.subtitle],
  );
  await setup.query("update events set current_award_id = $1, show_hall = $2, version = version + 1, updated_at = now() where id = 1", [
    savedEvent.current_award_id,
    savedEvent.show_hall,
  ]);
  await Promise.all([setup, a, b, ...extra].map((c) => c.end()));
});

beforeEach(expiredOpen);
afterEach(async () => {
  await a.query("rollback").catch(() => {});
  await b.query("rollback").catch(() => {});
});

describe("lock order events → awards", () => {
  // MC transaction already holds events (first line of set_award_status) while a reader expires the award.
  // Old expire_awards: reader locks the award, waits for events; MC then waits for the award → 40P01.
  it("reader expire_awards vs MC set_award_status on the expired award", async () => {
    const pa = await pidOf(a);
    await b.query("begin");
    await b.query("select 1 from events where id = 1 for update");
    await a.query("begin");
    const reader = settle(a.query("select expire_awards() as r"));
    await waitLocked(pa);
    const mc = settle(b.query("select set_award_status($1::smallint, 'closed'::award_status) as r", [AWARD]));
    const mcErr = await mc;
    await b.query(mcErr ? "rollback" : "commit");
    const readerErr = await reader;
    await a.query(readerErr ? "rollback" : "commit");
    expect([readerErr, mcErr]).toEqual([null, null]);
    const { rows } = await setup.query("select status from awards where id = $1", [AWARD]);
    expect(rows[0].status).toBe("closed");
  });

  it("set_award_title vs MC set_award_status on the same award", async () => {
    const pa = await pidOf(a);
    await b.query("begin");
    await b.query("select 1 from events where id = 1 for update");
    await a.query("begin");
    const rename = settle(a.query("select set_award_title($1::smallint, $2, null) as r", [AWARD, saved.title]));
    await waitLocked(pa);
    const mcErr = await settle(b.query("select set_award_status($1::smallint, 'closed'::award_status) as r", [AWARD]));
    await b.query(mcErr ? "rollback" : "commit");
    const renameErr = await rename;
    await a.query(renameErr ? "rollback" : "commit");
    expect([renameErr, mcErr]).toEqual([null, null]);
  });

  it(`${ROUNDS} rounds: readers expiring + every MC action at once, no deadlock`, async () => {
    const errors: string[] = [];
    for (let i = 0; i < ROUNDS; i++) {
      await expiredOpen();
      const results = await Promise.all([
        settle(a.query("select expire_awards() as r")),
        settle(extra[0].query("select expire_awards() as r")),
        settle(b.query("select set_award_status($1::smallint, $2::award_status) as r", [AWARD, i % 2 ? "closed" : "revealed"])),
        settle(extra[1].query("select extend_award($1::smallint, 30) as r", [AWARD])),
        settle(extra[2].query("select set_award_title($1::smallint, $2, null) as r", [AWARD, saved.title])),
        settle(extra[3].query("select set_current_award($1::smallint) as r", [AWARD])),
      ]);
      errors.push(...results.filter((e): e is string => e !== null));
      const { rows } = await setup.query("select status from awards where id = $1", [AWARD]);
      expect(rows[0].status, `round ${i}`).not.toBe("open");
    }
    expect(errors).toEqual([]);
  });
});
