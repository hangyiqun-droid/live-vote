import "server-only";
import { seedAwards } from "@/data/awards";
import type { AdminAction } from "@/lib/admin-actions";
import { runAdminAction } from "./admin";
import { readEventState } from "./state";

// Puts a demo deployment back to a fresh start: every award empty and pending (with its seeded name),
// the stage back on the lobby, the scan counter at zero. Every step is one of the MC's own buttons,
// so it goes through the same Postgres functions and state checks (reset_award refuses an award that
// is open or revealed, so those are closed first). Nothing is dropped or deleted outside reset_award.
export async function resetDemo(): Promise<{ ok: boolean; steps: number; failed: string[] }> {
  const failed: string[] = [];
  let steps = 0;
  const run = async (a: AdminAction) => {
    steps++;
    const r = await runAdminAction(a);
    if (!r.ok) failed.push(`${a.action}${"award_id" in a ? ` ${a.award_id}` : ""}: ${r.error}`);
  };

  await run({ action: "lobby" });
  await run({ action: "hide", on: false });
  await run({ action: "hall", on: false });
  await run({ action: "qr_fallback", on: false });

  const { awards } = await readEventState();
  for (const award of awards) {
    if (award.status === "open") await run({ action: "close", award_id: award.id });
    if (award.status === "revealed") await run({ action: "unreveal", award_id: award.id });
    await run({ action: "reset", award_id: award.id, confirm: award.title });
    const seed = seedAwards.find((s) => s.id === award.id);
    if (seed) await run({ action: "rename", award_id: award.id, title: seed.title, subtitle: "" });
  }
  await run({ action: "reset_scans" });
  return { ok: failed.length === 0, steps, failed };
}
