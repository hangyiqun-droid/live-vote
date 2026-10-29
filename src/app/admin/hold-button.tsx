"use client";

import { useEffect, useRef, useState } from "react";
import a from "./admin.module.css";

const HOLD_MS = 1500;

// Risky presses (close, reveal) = press and hold 1.5 s instead of a confirm() popup (SPEC 4.3).
// Works with touch, mouse and keyboard (hold Enter / Space).
export function HoldButton({
  children,
  onConfirm,
  disabled,
  tone = "primary",
  hint,
}: {
  children: React.ReactNode;
  onConfirm: () => void;
  disabled?: boolean;
  tone?: "primary" | "danger" | "gold";
  hint: string;
}) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  };
  const start = () => {
    if (disabled || timer.current) return;
    setHolding(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      setHolding(false);
      onConfirm();
    }, HOLD_MS);
  };
  useEffect(() => stop, []);

  const toneCls = tone === "danger" ? a.btnDanger : tone === "gold" ? a.btnGold : a.btnPrimary;
  return (
    <button
      type="button"
      className={`${a.btn} ${toneCls} ${a.hold}${holding ? ` ${a.holding}` : ""}`}
      disabled={disabled}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture?.(e.pointerId);
        start();
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !e.repeat) {
          e.preventDefault();
          start();
        }
      }}
      onKeyUp={(e) => {
        if (e.key === "Enter" || e.key === " ") stop();
      }}
      onBlur={stop}
    >
      <span className={a.holdFill} aria-hidden />
      <span className={a.holdLabel}>
        {children}
        <small>{holding ? "กดค้างไว้…" : hint}</small>
      </span>
    </button>
  );
}
