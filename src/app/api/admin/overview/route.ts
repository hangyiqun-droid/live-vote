import type { NextRequest } from "next/server";
import { readAdminOverview } from "@/lib/server/admin";
import { isAdmin } from "@/lib/server/admin-session";
import { withBase } from "@/lib/base-path";
import { json, serverError } from "@/lib/server/http";
import { expireAndRead } from "@/lib/server/state";

// Everything the MC page shows: statuses, live counts of every award, verify_tallies (SPEC 4.3)
export async function GET(req: NextRequest) {
  if (!isAdmin(req)) return json({ error: "unauthorized" }, 401);
  try {
    await expireAndRead();
    // Stage link with its key, for the MC's copy button — only ever sent to a signed-in MC
    const k = process.env.STAGE_KEY;
    return json({ ...(await readAdminOverview()), stage_path: k ? withBase(`/stage?k=${encodeURIComponent(k)}`) : null });
  } catch (e) {
    return serverError("admin/overview", e);
  }
}
