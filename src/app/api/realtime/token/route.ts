import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { createTokenRequest } from "@/lib/server/ably";
import { json, serverError } from "@/lib/server/http";
import { isStageKey } from "@/lib/server/stage-key";

// Ably token by role (SPEC 1.1 #6). Without a valid stage key you get the phone token,
// which can only subscribe to event:event — never the tally.
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const wantsStage = params.get("role") === "stage";
  if (wantsStage && !isStageKey(params.get("k"))) {
    return json({ error: "bad_key" }, 401);
  }
  try {
    const tokenRequest = wantsStage
      ? await createTokenRequest("stage", `stage-${randomUUID()}`)
      : await createTokenRequest("mobile");
    return json(tokenRequest);
  } catch (e) {
    return serverError("realtime/token", e);
  }
}
