"use client";

import { useLayoutEffect, useRef } from "react";
import { H, W } from "./geometry";
import s from "./stage.module.css";

// Designed once at 1920×1080 and scaled to whatever the projector window is (letterboxed)
export function Canvas({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const fit = () => {
      const el = ref.current;
      if (!el) return;
      const k = Math.min(window.innerWidth / W, window.innerHeight / H);
      const x = (window.innerWidth - W * k) / 2;
      const y = (window.innerHeight - H * k) / 2;
      el.style.transform = `translate(${x}px, ${y}px) scale(${k})`;
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  return (
    <div className={s.viewport}>
      <div ref={ref} className={s.canvas}>
        <div className={s.bg} />
        {children}
      </div>
    </div>
  );
}
