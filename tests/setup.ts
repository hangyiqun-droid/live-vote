import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const url = process.env.DATABASE_URL_UNPOOLED ?? "";
// Guard: the Neon "main" branch (production) must never be touched by tests
if (!url.includes("ep-example-123") && !process.env.EVENT_TEST_DB_OK) {
  throw new Error("tests only run against the Neon dev branch (set EVENT_TEST_DB_OK=1 for another test branch)");
}
