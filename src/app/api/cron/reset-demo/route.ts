import { createHmac, timingSafeEqual } from "node:crypto";
import { connection, type NextRequest } from "next/server";
import { isDemo } from "@/lib/demo";
import { json, serverError } from "@/lib/server/http";
import { resetDemo } from "@/lib/server/demo-reset";

const same = (a: string, b: string) => {
  const ha = createHmac("sha256", "cmp").update(a).digest();
  const hb = createHmac("sha256", "cmp").update(b).digest();
  return timingSafeEqual(ha, hb);
};

// Daily reset of a demo deployment (vercel.json cron). Vercel sends `Authorization: Bearer $CRON_SECRET`.
// Outside demo mode this route does not exist: 404 before anything else is looked at.
export async function GET(req: NextRequest) {
  await connection(); // read env and headers per request, never a build-time answer
  if (!isDemo()) return json({ error: "not_found" }, 404);
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization") ?? "";
  if (!secret || !same(given, `Bearer ${secret}`)) return json({ error: "unauthorized" }, 401);
  try {
    const r = await resetDemo();
    console.log(`[cron] reset-demo ${r.ok ? "ok" : "partial"} (${r.steps} steps${r.failed.length ? `, failed: ${r.failed.join("; ")}` : ""})`);
    return json(r, r.ok ? 200 : 500);
  } catch (e) {
    return serverError("cron/reset-demo", e);
  }
}
