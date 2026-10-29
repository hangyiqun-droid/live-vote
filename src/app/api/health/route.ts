import { connection } from "next/server";
import { pool } from "@/db/client";
import { json } from "@/lib/server/http";
import { VERSION } from "@/version";

// Wakes Neon when the stage presses "start" (SPEC 4.1) and lets ops curl the deployment
export async function GET() {
  await connection();
  const started = performance.now();
  try {
    await pool.query("select 1");
    return json({ ok: true, version: VERSION, db_ms: Math.round(performance.now() - started) });
  } catch {
    return json({ ok: false, version: VERSION }, 503);
  }
}
