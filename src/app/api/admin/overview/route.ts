import type { NextRequest } from "next/server";
import { readAdminOverview } from "@/lib/server/admin";
import { isAdmin } from "@/lib/server/admin-session";
import { LOGIN_TAG_COOKIE, parseTag } from "@/lib/server/login-guard";
import { ensureLoginTag } from "@/lib/server/login-tag";
import { withBase } from "@/lib/base-path";
import { json, serverError } from "@/lib/server/http";
import { readScanCount } from "@/lib/server/lobby";
import { expireAndRead } from "@/lib/server/state";

// Everything the MC page shows: statuses, live counts of every award, verify_tallies (SPEC 4.3)
export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    // The login screen is about to show — give this browser its login tag now (login-guard.ts)
    const res = json({ error: "unauthorized" }, 401);
    ensureLoginTag(parseTag(req.cookies.get(LOGIN_TAG_COOKIE)?.value)).set(res);
    return res;
  }
  try {
    await expireAndRead();
    // Stage link with its key, for the MC's copy button — only ever sent to a signed-in MC
    const k = process.env.STAGE_KEY;
    const scans = await readScanCount();
    return json({ ...(await readAdminOverview()), scans: scans.count, stage_path: k ? withBase(`/stage?k=${encodeURIComponent(k)}`) : null });
  } catch (e) {
    return serverError("admin/overview", e);
  }
}
