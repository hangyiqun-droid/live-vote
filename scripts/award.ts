// Dev-only MC stand-in until the admin page lands in M3. Calls the same Postgres functions the
// admin API will call, then announces the new state on Ably.
// Usage (dev branch only):
//   pnpm award open <id> [seconds]   pnpm award close <id>   pnpm award reveal <id>
//   pnpm award reset <id>            pnpm award current <id|lobby>   pnpm award hide on|off
//   pnpm award status
import { config } from "dotenv";
import * as Ably from "ably";
import { Client } from "pg";
import { pgUrl } from "../src/db/pg-url";
import { CHANNEL_EVENT, CHANNEL_TALLY } from "../src/lib/types";

config({ path: ".env.local", quiet: true });

async function main() {
  const [cmd, arg, extra] = process.argv.slice(2);
  const db = new Client({ connectionString: pgUrl(process.env.DATABASE_URL_UNPOOLED) });
  await db.connect();
  const one = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows[0]?.r;
  try {
    let result: unknown;
    const id = Number(arg);
    switch (cmd) {
      case "open":
        result = await one("select set_award_status($1, 'open', $2) as r", [id, extra ? Number(extra) : null]);
        break;
      case "close":
        result = await one("select set_award_status($1, 'closed') as r", [id]);
        break;
      case "reveal":
        result = await one("select set_award_status($1, 'revealed') as r", [id]);
        break;
      case "reset":
        result = await one("select reset_award($1) as r", [id]);
        break;
      case "current":
        result = await one("select set_current_award($1) as r", [arg === "lobby" ? null : id]);
        break;
      case "hide":
        result = await one("select set_hide_counts($1) as r", [arg === "on"]);
        break;
      case "status":
        break;
      default:
        throw new Error(`unknown command: ${cmd}`);
    }
    const state = await one("select event_state() as r");
    if (cmd !== "status") {
      const ably = new Ably.Rest({ key: process.env.ABLY_API_KEY! });
      await ably.channels.get(CHANNEL_EVENT).publish("state", state);
      if (state.current_award_id) {
        const snap = await one("select award_snapshot($1) as r", [state.current_award_id]);
        await ably.channels.get(CHANNEL_TALLY).publish("tally", snap);
      }
      console.log(JSON.stringify(result));
    }
    const verify = await db.query("select id, verify_tallies(id) ok from awards order by id");
    console.table(
      state.awards.map((a: { id: number; title: string; status: string }) => ({
        id: a.id,
        title: a.title,
        status: a.status,
        current: a.id === state.current_award_id,
        tallies_ok: verify.rows.find((r) => r.id === a.id)?.ok,
      })),
    );
  } finally {
    await db.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
