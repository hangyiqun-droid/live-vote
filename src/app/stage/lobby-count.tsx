"use client";

import { useLayoutEffect, useRef } from "react";
import { UsersIcon } from "@heroicons/react/24/solid";
import { cue } from "./cues";
import { Count } from "./count";
import s from "./stage.module.css";

// "สแกนแล้ว N คน" — big enough to read from the back of the room (fix9). The number counts up with
// the shared <Count> tween (toLocaleString th-TH), the block pops, a ring spreads, and a soft tick
// plays for each new face. `value` null = the first reading has not arrived yet.
export function LobbyCount({ value }: { value: number | null }) {
  const box = useRef<HTMLDivElement>(null);
  const last = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (value === null) return;
    const before = last.current;
    last.current = value;
    if (before === null || value <= before) return; // first reading, or the MC cleared the counter
    box.current?.animate([{ transform: "scale(1)" }, { transform: "scale(1.1)" }, { transform: "scale(1)" }], {
      duration: 420,
      easing: "cubic-bezier(0.34, 1.56, 0.64, 1)",
    });
    cue("sfx_tick", { votes: Math.min(value - before, 3) });
  }, [value]);

  return (
    <div className={s.scanBox} ref={box} role="status" aria-live="polite" data-scan-count={value ?? ""}>
      <p className={s.scanLabel}>
        <UsersIcon aria-hidden />
        สแกนเข้าระบบแล้ว
      </p>
      <p className={s.scanLine}>
        <span className={s.scanNumber}>{value === null ? "–" : <Count value={value} />}</span>
        <span className={s.scanUnit}>คน</span>
      </p>
      {value !== null && <span key={value} className={s.scanRing} aria-hidden />}
    </div>
  );
}
