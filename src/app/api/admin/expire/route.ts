import { connection } from "next/server";
import { json, serverError } from "@/lib/server/http";
import { allow } from "@/lib/server/rate-limit";
import { expireAndRead } from "@/lib/server/state";

// SPEC 3.1: whoever sees the countdown hit zero (stage or MC page) calls this. It only closes
// awards whose auto_close_at has really passed on the server clock, so it needs no key and is
// idempotent — the first caller wins, the rest get the same answer.
export async function POST() {
  await connection();
  if (!allow("expire", 120)) return json({ error: "rate_limited" }, 429);
  try {
    const state = await expireAndRead();
    return json({ ok: true, version: state.version });
  } catch (e) {
    return serverError("admin/expire", e);
  }
}
