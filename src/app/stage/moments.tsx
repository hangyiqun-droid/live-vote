"use client";

import { useEffect, useRef, useState } from "react";
import { withBase } from "@/lib/base-path";
import type { AwardState } from "@/lib/types";
import { cue } from "./cues";
import { fitTitle } from "./title-fit";
import r from "./reveal.module.css";

// Award just opened: its title card flies into the middle, then shrinks up into the race header
export function OpenIntro({ title, onDone }: { title: string; onDone: () => void }) {
  useEffect(() => cue("sfx_open"), []);
  return (
    <div className={r.openIntro} aria-hidden>
      <div className={r.openCard} style={{ fontSize: fitTitle(title, 110, 1640) }} onAnimationEnd={onDone}>
        {title}
      </div>
    </div>
  );
}

// Countdown side effects (the number itself is drawn in the vote panel): a sound cue for each of
// the last 10 seconds, and at zero the stage asks the server to close the award
// (/api/admin/expire — idempotent, the server clock decides).
export function CountdownCues({ award, clockOffset }: { award: AwardState; clockOffset: number }) {
  const endsAt = award.auto_close_at ? Date.parse(award.auto_close_at) : null;
  const [left, setLeft] = useState<number | null>(null);
  const asked = useRef(false);

  useEffect(() => {
    if (endsAt === null) return;
    const tick = () => setLeft(Math.max(0, Math.ceil((endsAt - Date.now() - clockOffset) / 1000)));
    queueMicrotask(tick);
    const t = setInterval(tick, 200);
    return () => clearInterval(t);
  }, [endsAt, clockOffset]);

  useEffect(() => {
    if (left === null || left > 10) return;
    if (left > 0) {
      cue("sfx_count", { left });
      return;
    }
    if (asked.current) return;
    asked.current = true;
    const expire = () => void fetch(withBase("/api/admin/expire"), { method: "POST", cache: "no-store" }).catch(() => undefined);
    expire();
    // If that request was lost, ask once more; a closed award unmounts this before it fires
    const t = setTimeout(expire, 2500);
    return () => clearTimeout(t);
  }, [left]);

  return null;
}
