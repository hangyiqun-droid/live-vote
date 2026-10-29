import "server-only";
import { callFn, pool } from "@/db/client";
import type { EventState, TallySnapshot } from "@/lib/types";
import { publishEvent, publishTally } from "./ably";

export const readEventState = () => callFn<EventState>("event_state");
export const readSnapshot = (awardId: number) => callFn<TallySnapshot | null>("award_snapshot", [awardId]);

// Countdown expiry is server-side (SPEC 3.1): any reader closes overdue awards and announces it.
export async function expireAndRead(): Promise<EventState> {
  const { rows } = await pool.query<{ ids: number[] }>("select expire_awards() as ids");
  const state = await readEventState();
  const ids = rows[0].ids ?? [];
  if (ids.length > 0) {
    await publishEvent(state);
    for (const id of ids) {
      const snap = await readSnapshot(id);
      if (snap) await publishTally(snap);
    }
  }
  return state;
}
