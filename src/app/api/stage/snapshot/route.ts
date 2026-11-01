import type { NextRequest } from "next/server";
import { json, serverError } from "@/lib/server/http";
import { isStageKey } from "@/lib/server/stage-key";
import { readScanCount } from "@/lib/server/lobby";
import { expireAndRead, readSnapshot } from "@/lib/server/state";

// Full picture for the stage after (re)connecting and every 15 s as a safety net
export async function GET(req: NextRequest) {
  if (!isStageKey(req.nextUrl.searchParams.get("k"))) {
    return json({ error: "bad_key" }, 401);
  }
  try {
    const state = await expireAndRead();
    const tally = state.current_award_id ? await readSnapshot(state.current_award_id) : null;
    // The hall of winners needs every revealed award, not only the current one
    const hall = state.show_hall
      ? await Promise.all(state.awards.filter((a) => a.status === "revealed").map((a) => readSnapshot(a.id)))
      : [];
    // The lobby counter rides along: this is how the stage catches up after a drop
    return json({ state, tally, hall: hall.filter(Boolean), scans: await readScanCount() }); // null = migration 0006 not applied: the stage hides the counter
  } catch (e) {
    return serverError("stage/snapshot", e);
  }
}
