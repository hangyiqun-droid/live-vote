import "server-only";
import { callFn } from "@/db/client";
import { EXTEND_SECONDS, TIMER_CHOICES, type AdminAction } from "@/lib/admin-actions";
import type { AdminOverview, EventState } from "@/lib/types";
import { publishEvent, publishTally } from "./ably";
import { readEventState, readSnapshot } from "./state";

// Every MC button (SPEC 4.3). Each one maps to a single Postgres function that checks the
// state machine (SPEC 3.1), so pressing the same button twice is harmless (idempotent).
type FnResult = { ok: boolean; error?: string };

const id = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v > 0 && v < 100 ? v : null);
const str = (v: unknown) => (typeof v === "string" ? v : null);
const bool = (v: unknown) => (typeof v === "boolean" ? v : null);

// Untrusted JSON → a known action, or null
export function parseAction(b: Record<string, unknown>): AdminAction | null {
  const award_id = id(b.award_id);
  switch (b.action) {
    case "lobby":
      return { action: "lobby" };
    case "hide":
    case "hall":
    case "qr_fallback": {
      const on = bool(b.on);
      return on === null ? null : { action: b.action, on };
    }
    case "open": {
      const seconds = typeof b.seconds === "number" ? b.seconds : 0;
      if (!award_id || !(TIMER_CHOICES as readonly number[]).includes(seconds)) return null;
      return { action: "open", award_id, seconds };
    }
    case "reset": {
      const confirm = str(b.confirm);
      return award_id && confirm !== null ? { action: "reset", award_id, confirm } : null;
    }
    case "rename": {
      const title = str(b.title);
      const subtitle = str(b.subtitle) ?? "";
      return award_id && title !== null ? { action: "rename", award_id, title, subtitle } : null;
    }
    case "show":
    case "close":
    case "reopen":
    case "reveal":
    case "unreveal":
    case "extend":
      return award_id ? { action: b.action, award_id } : null;
    default:
      return null;
  }
}

async function run(a: AdminAction): Promise<FnResult> {
  switch (a.action) {
    case "show":
      return callFn("set_current_award", [a.award_id]);
    case "lobby":
      return callFn("set_current_award", [null]);
    case "open":
      return callFn("set_award_status", [a.award_id, "open", a.seconds || null]);
    case "close":
    case "unreveal":
      return callFn("set_award_status", [a.award_id, "closed"]);
    case "reopen":
      return callFn("set_award_status", [a.award_id, "open", null]);
    case "reveal":
      return callFn("set_award_status", [a.award_id, "revealed"]);
    case "extend":
      return callFn("extend_award", [a.award_id, EXTEND_SECONDS]);
    case "reset": {
      // Typed award name is checked here too, not only on the page (SPEC 4.3)
      const state = await readEventState();
      const award = state.awards.find((x) => x.id === a.award_id);
      if (!award) return { ok: false, error: "not_found" };
      if (a.confirm.trim() !== award.title.trim()) return { ok: false, error: "confirm_mismatch" };
      return callFn("reset_award", [a.award_id]);
    }
    case "hide":
      return callFn("set_hide_counts", [a.on]);
    case "hall":
      return callFn("set_show_hall", [a.on]);
    case "qr_fallback":
      return callFn("set_qr_fallback", [a.on]);
    case "rename":
      return callFn("set_award_title", [a.award_id, a.title, a.subtitle]);
  }
}

// Announce the new state, then the tallies the stage will need for it
async function announce(state: EventState, touched: number | null) {
  await publishEvent(state);
  const ids = new Set<number>();
  if (touched) ids.add(touched);
  if (state.current_award_id) ids.add(state.current_award_id);
  if (state.show_hall) for (const x of state.awards) if (x.status === "revealed") ids.add(x.id);
  for (const awardId of ids) {
    const snap = await readSnapshot(awardId);
    if (snap) await publishTally(snap);
  }
}

export async function runAdminAction(a: AdminAction): Promise<{ ok: true } | { ok: false; error: string }> {
  const r = await run(a);
  if (!r.ok) return { ok: false, error: r.error ?? "failed" };
  await announce(await readEventState(), "award_id" in a ? a.award_id : null);
  return { ok: true };
}

export const readAdminOverview = () => callFn<AdminOverview>("admin_overview");
