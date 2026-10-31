import type { NextRequest } from "next/server";
import { parseAction, readAdminOverview, runAdminAction } from "@/lib/server/admin";
import { isAdmin } from "@/lib/server/admin-session";
import { json, serverError } from "@/lib/server/http";
import { readScanCount } from "@/lib/server/lobby";

// One endpoint for every MC button; answers with the fresh overview so the page updates at once
export async function POST(req: NextRequest) {
  if (!isAdmin(req)) return json({ error: "unauthorized" }, 401);
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  const action = parseAction(body ?? {});
  if (!action) return json({ error: "bad_request" }, 400);
  try {
    const r = await runAdminAction(action);
    const overview = await readAdminOverview();
    const scans = (await readScanCount())?.count ?? null;
    console.log(`[admin] ${action.action}${"award_id" in action ? ` ${action.award_id}` : ""} ${r.ok ? "ok" : r.error}`);
    return json(r.ok ? { ok: true, overview, scans } : { ok: false, error: r.error, overview, scans }, r.ok ? 200 : 409);
  } catch (e) {
    return serverError("admin/action", e);
  }
}
