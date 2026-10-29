// Apply drizzle/ migrations. Usage: pnpm db:migrate (DATABASE_URL_UNPOOLED from .env.local).
// Only ever point this at a test branch from a child worktree — main runs it on prod after QA.
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

config({ path: ".env.local", quiet: true });

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED;
  if (!url) throw new Error("DATABASE_URL_UNPOOLED is not set");
  console.log("migrating", new URL(url).hostname);
  const pool = new Pool({ connectionString: url, max: 1 });
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  await pool.end();
  console.log("done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
