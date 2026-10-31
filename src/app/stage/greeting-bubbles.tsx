"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Greeting } from "@/lib/types";
import { BUBBLE_SLOTS, bubbleSlot } from "./lobby-layout";
import { attachBubbles, takeGreeting } from "./greeting-store";
import s from "./stage.module.css";

// A bubble stays about 7 s (the CSS animation is the same length) and then fades by itself
export const BUBBLE_MS = 7_000;
const ACCENTS = ["#f59e0b", "#38bdf8", "#34d399", "#fb7185"];

type Shown = (Greeting & { n: number }) | null;

// Six fixed slots under the faces (lobby-layout.ts), so a bubble can never land on a face or the QR.
// More than six greetings at once wait in the store (the oldest is dropped past 12).
// Mounted only while the lobby is on screen and the MC switch is on: unmounting clears everything.
export function GreetingBubbles() {
  const [slots, setSlots] = useState<Shown[]>(() => Array.from({ length: BUBBLE_SLOTS }, () => null));
  const slotsRef = useRef(slots);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const counter = useRef(0);

  useEffect(() => {
    const live = timers.current;
    const fill = () => {
      const next = [...slotsRef.current];
      let changed = false;
      for (;;) {
        const free = next.flatMap((x, i) => (x === null ? [i] : []));
        if (free.length === 0) break;
        const g = takeGreeting();
        if (!g) break;
        const at = free[Math.floor(Math.random() * free.length)];
        const n = ++counter.current;
        next[at] = { ...g, n };
        changed = true;
        const t = setTimeout(() => {
          live.delete(t);
          slotsRef.current = slotsRef.current.map((x, i) => (i === at && x?.n === n ? null : x));
          setSlots(slotsRef.current);
          fill();
        }, BUBBLE_MS + 100);
        live.add(t);
      }
      if (changed) {
        slotsRef.current = next;
        setSlots(next);
      }
    };
    const detach = attachBubbles(fill);
    return () => {
      detach();
      live.forEach(clearTimeout);
      live.clear();
    };
  }, []);

  return (
    <div className={s.bubbles} data-bubbles aria-live="off">
      {slots.map((b, i) => {
        const r = bubbleSlot(i);
        return (
          <div key={i} className={s.bubbleSlot} style={{ left: r.x, top: r.y, width: r.w, height: r.h }} data-bubble-slot={i}>
            {b && (
              <p
                key={b.n}
                className={s.bubble}
                style={{ "--accent": ACCENTS[b.n % ACCENTS.length], animationDuration: `${BUBBLE_MS}ms` } as CSSProperties}
                data-bubble
              >
                {b.text}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
