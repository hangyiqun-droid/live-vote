import "server-only";
import { callFn } from "@/db/client";
import { isDemo } from "@/lib/demo";
import type { EventState, TallySnapshot } from "@/lib/types";
import { publishEvent, publishTally } from "./ably";

// In demo mode strangers can open the vote page, so greetings (text that lands on the big screen)
// stay off whatever the MC switch says
export const withDemo = (s: EventState): EventState => (isDemo() ? { ...s, demo: true, greetings_on: false } : s);

export const readEventState = async () => withDemo(await callFn<EventState>("event_state"));
export const readSnapshot = (awardId: number) => callFn<TallySnapshot | null>("award_snapshot", [awardId]);

// Countdown expiry is server-side: any reader closes overdue awards and announces it.
export async function expireAndRead(): Promise<EventState> {
  const ids = (await callFn<number[] | null>("expire_awards")) ?? [];
  const state = await readEventState();
  if (ids.length > 0) {
    await publishEvent(state);
    for (const id of ids) {
      const snap = await readSnapshot(id);
      if (snap) await publishTally(snap);
    }
  }
  return state;
}
