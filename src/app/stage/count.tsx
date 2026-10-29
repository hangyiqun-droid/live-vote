"use client";

import { useLayoutEffect, useRef } from "react";

const fmt = (n: number) => n.toLocaleString("th-TH");

// Number that counts up to its new value (SPEC 5.2). React never owns the text node — the tween
// writes textContent directly, so a burst of votes does not re-render anything per frame.
export function Count({ value, hidden, className }: { value: number; hidden?: boolean; className?: string }) {
  const el = useRef<HTMLSpanElement>(null);
  const shown = useRef<number | null>(null);

  useLayoutEffect(() => {
    const node = el.current;
    if (!node) return;
    if (hidden) {
      node.textContent = "?";
      shown.current = 0; // un-hiding counts up from 0 to the real value (SPEC 4.1)
      return;
    }
    const from = shown.current ?? value;
    shown.current = value;
    if (from === value) {
      node.textContent = fmt(value);
      return;
    }
    const start = performance.now();
    const dur = 400;
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / dur);
      const eased = 1 - (1 - k) ** 3;
      node.textContent = fmt(Math.round(from + (value - from) * eased));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      node.textContent = fmt(value);
    };
  }, [value, hidden]);

  return <span ref={el} className={className} />;
}
