import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { isAdmin } from "@/lib/server/admin-session";
import { createTokenRequest } from "@/lib/server/ably";
import { json, serverError } from "@/lib/server/http";
import { isStageKey } from "@/lib/server/stage-key";

// Ably token by role (SPEC 1.1 #6). Without a valid stage key you get the phone token,
// which can only subscribe to event:event — never the tally. The MC page needs its session cookie.
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const role = params.get("role");
  if (role === "stage" && !isStageKey(params.get("k"))) {
    return json({ error: "bad_key" }, 401);
  }
  if (role === "admin" && !isAdmin(req)) {
    return json({ error: "unauthorized" }, 401);
  }
  try {
    const tokenRequest =
      role === "stage"
        ? await createTokenRequest("stage", `stage-${randomUUID()}`)
        : role === "admin"
          ? await createTokenRequest("admin", `admin-${randomUUID()}`)
          : await createTokenRequest("mobile");
    return json(tokenRequest);
  } catch (e) {
    return serverError("realtime/token", e);
  }
}
