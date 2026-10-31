"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { Greeting } from "@/lib/types";
import { FONT_STEPS, TILTS, TONES, startStep } from "./bubble-style";
import { cue } from "./cues";
import { BUBBLE_RISE, BUBBLE_SLOTS, BUBBLE_TAIL_H, BUBBLE_W, bubbleSlot } from "./lobby-layout";
import { attachBubbles, takeGreeting } from "./greeting-store";
import s from "./stage.module.css";

// A bubble stays about 7 s (the CSS animation is the same length) and then fades by itself
export const BUBBLE_MS = 7_000;
const TAIL_INSET = 52; // tail distance from the bubble's near edge, px
const TAIL_W = 46;

type Shown = (Greeting & { n: number }) | null;

// Biggest font size at which the text fits the bubble: starts from what the length suggests and steps
// down (bubble-style.ts). Runs before paint, so the first frame is already the right size. Reads
// offsetHeight / scrollWidth, which a running transform animation does not change.
function fitText(box: HTMLElement, span: HTMLElement, length: number) {
  const cs = getComputedStyle(box);
  // 4 px spare: tone marks rise above the line box and must not touch the bubble's rim
  const room = box.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - 4;
  const wide = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  for (let i = startStep(length); i < FONT_STEPS.length; i++) {
    box.style.fontSize = `${FONT_STEPS[i]}px`;
    if (span.offsetHeight <= room && span.scrollWidth <= wide) return;
  }
}

function Bubble({ greeting, slot }: { greeting: Greeting & { n: number }; slot: number }) {
  const box = useRef<HTMLDivElement>(null);
  const span = useRef<HTMLSpanElement>(null);
  const { n, text } = greeting;
  const flip = (n + slot) % 2 === 0 ? 1 : -1; // tail on the left or the right, alternating
  const tailX = flip === 1 ? TAIL_INSET : BUBBLE_W - TAIL_INSET - TAIL_W;
  const tone = TONES[n % TONES.length];

  useLayoutEffect(() => {
    if (box.current && span.current) fitText(box.current, span.current, Array.from(text).length);
  }, [text]);

  return (
    <div
      className={s.bubble}
      style={
        {
          "--c1": tone.c1,
          "--c2": tone.c2,
          "--ink": tone.ink,
          "--tilt": `${TILTS[(n * 5 + slot) % TILTS.length]}deg`,
          "--rise": `${BUBBLE_RISE[slot]}px`,
          "--tail-x": `${tailX}px`,
          "--tail-h": `${BUBBLE_TAIL_H}px`,
          "--bubble-w": `${BUBBLE_W}px`,
          "--tip-x": `${tailX + (flip === 1 ? 8 : 38)}px`,
          animationDuration: `${BUBBLE_MS}ms`,
        } as CSSProperties
      }
      data-bubble
    >
      <div className={s.bubbleTilt} style={{ animationDuration: `${BUBBLE_MS}ms` }} data-bubble-tilt>
        <div className={s.bubbleBody} />
        <i className={s.tailRim} data-flip={flip} />
        <i className={s.tailFill} data-flip={flip} />
        <div className={s.bubbleText} ref={box}>
          <span ref={span}>{text}</span>
        </div>
      </div>
    </div>
  );
}

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
        cue("sfx_tick", { votes: 1 }); // the soft pop the scan counter uses; the engine rate-limits it
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
            {b && <Bubble key={b.n} greeting={b} slot={i} />}
          </div>
        );
      })}
    </div>
  );
}
