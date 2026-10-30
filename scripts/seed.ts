// Idempotent seed: 5 awards, 29 nominees, the event row, 145 tally rows.
// Usage: pnpm db:seed   (uses DATABASE_URL_UNPOOLED from .env.local)
import { config } from "dotenv";
import { Client } from "pg";
import { seedAwards } from "../src/data/awards";
import { nominees, EVENT_TITLE } from "../src/data/nominees";

config({ path: ".env.local", quiet: true });

async function main() {
  const db = new Client({ connectionString: process.env.DATABASE_URL_UNPOOLED });
  await db.connect();
  try {
    await db.query("begin");
    for (const a of seedAwards) {
      // Keep titles already set by the MC/main — seed only fills gaps
      await db.query(
        "insert into awards (id, slug, title, sort_order) values ($1, $2, $3, $4) on conflict (id) do nothing",
        [a.id, a.slug, a.title, a.sortOrder],
      );
    }
    for (const n of nominees) {
      await db.query(
        `insert into nominees (id, nickname, first_name, grp) values ($1, $2, $3, $4)
         on conflict (id) do update set nickname = excluded.nickname, first_name = excluded.first_name, grp = excluded.grp`,
        [n.id, n.nickname, n.firstName, n.group],
      );
    }
    await db.query("insert into events (id, title) values (1, $1) on conflict (id) do nothing", [EVENT_TITLE]);
    await db.query(
      `insert into tallies (award_id, nominee_id, votes)
       select a.id, n.id, 0 from awards a cross join nominees n on conflict do nothing`,
    );
    await db.query("commit");
    const { rows } = await db.query(
      "select (select count(*) from awards) awards, (select count(*) from nominees) nominees, (select count(*) from tallies) tallies",
    );
    console.log("seeded", rows[0]);
  } catch (e) {
    await db.query("rollback");
    throw e;
  } finally {
    await db.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
