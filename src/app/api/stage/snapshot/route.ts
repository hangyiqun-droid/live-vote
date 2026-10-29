import type { NextRequest } from "next/server";
import { json, serverError } from "@/lib/server/http";
import { isStageKey } from "@/lib/server/stage-key";
import { expireAndRead, readSnapshot } from "@/lib/server/state";

// Full picture for the stage after (re)connecting and every 15 s as a safety net (SPEC 1.1 #5)
export async function GET(req: NextRequest) {
  if (!isStageKey(req.nextUrl.searchParams.get("k"))) {
    return json({ error: "bad_key" }, 401);
  }
  try {
    const state = await expireAndRead();
    const tally = state.current_award_id ? await readSnapshot(state.current_award_id) : null;
    return json({ state, tally });
  } catch (e) {
    return serverError("stage/snapshot", e);
  }
}
