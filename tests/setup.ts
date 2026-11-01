import { config } from "dotenv";
import { isTestHost } from "@/db/test-host";

config({ path: ".env.local", quiet: true });

// Guard: tests write to the database, so they only run against the host named in TEST_DB_HOST
// (the first label of your *test* database's hostname) — never a database you care about.
if (!isTestHost(process.env.DATABASE_URL_UNPOOLED)) {
  throw new Error("tests only run against the test database: set TEST_DB_HOST to the first label of DATABASE_URL_UNPOOLED's hostname");
}
