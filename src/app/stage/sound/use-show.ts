"use client";

import { useEffect, useState } from "react";
import { withBase } from "@/lib/base-path";
import { prefetchSound, type SoundEngine } from "./engine";
import { holdWakeLock, startShow } from "./start";

// The stage's sound player: files are fetched while the gate is up, started by the press
export function useShow() {
  const [engine, setEngine] = useState<SoundEngine | null>(null);

  useEffect(() => prefetchSound(), []);

  useEffect(() => {
    if (!engine) return;
    const release = holdWakeLock();
    return () => {
      release();
      engine.close();
    };
  }, [engine]);

  const start = () => {
    if (engine) return;
    setEngine(startShow());
    void fetch(withBase("/api/health"), { cache: "no-store" }).catch(() => undefined); // wake Neon
  };

  return { engine, start };
}
