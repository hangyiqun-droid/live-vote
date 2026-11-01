"use client";

import { useEffect, useState } from "react";
import {
  ArrowsPointingOutIcon,
  MinusIcon,
  MusicalNoteIcon,
  PlayIcon,
  PlusIcon,
  SpeakerWaveIcon,
  SpeakerXMarkIcon,
} from "@heroicons/react/24/solid";
import type { EngineState, Settings, SoundEngine } from "./engine";
import c from "./sound.module.css";

const HIDE_AFTER_MS = 3000;
const STEP = 0.1;
const pct = (v: number) => `${Math.round(v * 100).toLocaleString("th-TH")}%`;

// Full-screen first screen of the stage: one press unlocks sound, full screen and the wake lock
export function StartGate({ title, onStart }: { title: string; onStart: () => void }) {
  return (
    <div className={c.gate}>
      <p className={c.gateTitle}>{title}</p>
      <button type="button" className={c.gateButton} onClick={onStart} autoFocus>
        <PlayIcon aria-hidden />
        เริ่มงาน
      </button>
      <p className={c.gateHint}>กดครั้งเดียว เปิดเสียง + เต็มจอ + กันจอดับ</p>
    </div>
  );
}

export function useEngineState(engine: SoundEngine | null): EngineState | null {
  const [state, setState] = useState<EngineState | null>(engine?.state ?? null);
  useEffect(() => {
    if (!engine) return;
    queueMicrotask(() => setState(engine.state));
    return engine.onState(setState);
  }, [engine]);
  return state;
}

// Corner notice when the browser still holds the sound back, or the files failed to load
export function SoundNotice({ engine }: { engine: SoundEngine }) {
  const state = useEngineState(engine);
  if (state === "blocked") {
    return (
      <button type="button" className={c.notice} onClick={() => void engine.resume()}>
        <SpeakerXMarkIcon aria-hidden />
        แตะเพื่อเปิดเสียง
      </button>
    );
  }
  if (state === "failed") {
    return (
      <button type="button" className={c.notice} role="alert" onClick={() => void engine.load()}>
        <SpeakerXMarkIcon aria-hidden />
        โหลดเสียงไม่สำเร็จ — แตะเพื่อลองใหม่
      </button>
    );
  }
  return null;
}

// Hidden panel: shows up when the mouse moves, gone again 3 s later
export function SoundControls({ engine }: { engine: SoundEngine }) {
  const [shown, setShown] = useState(false);
  const [s, setS] = useState<Settings>(engine.settings);

  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const wake = () => {
      setShown(true);
      clearTimeout(t);
      t = setTimeout(() => setShown(false), HIDE_AFTER_MS);
    };
    window.addEventListener("mousemove", wake);
    window.addEventListener("keydown", wake);
    return () => {
      clearTimeout(t);
      window.removeEventListener("mousemove", wake);
      window.removeEventListener("keydown", wake);
    };
  }, []);

  const update = (patch: Partial<Settings>) => {
    const next = { ...s, ...patch };
    setS(next);
    engine.apply(next);
  };
  const clamp = (v: number) => Math.min(1, Math.max(0, Math.round(v * 10) / 10));

  const level = (label: string, k: "master" | "bgm" | "sfx" | "show") => (
    <div className={c.row} key={k}>
      <span>{label}</span>
      <button type="button" aria-label={`ลด${label}`} onClick={() => update({ [k]: clamp(s[k] - STEP) })}>
        <MinusIcon aria-hidden />
      </button>
      <output aria-live="polite">{pct(s[k])}</output>
      <button type="button" aria-label={`เพิ่ม${label}`} onClick={() => update({ [k]: clamp(s[k] + STEP) })}>
        <PlusIcon aria-hidden />
      </button>
    </div>
  );

  return (
    <div className={shown ? `${c.panel} ${c.panelShown}` : c.panel} data-sound-panel onFocus={() => setShown(true)}>
      <div className={c.toggles}>
        <button type="button" aria-pressed={!s.muted} onClick={() => update({ muted: !s.muted })}>
          {s.muted ? <SpeakerXMarkIcon aria-hidden /> : <SpeakerWaveIcon aria-hidden />}
          {s.muted ? "เสียงปิด" : "เสียงเปิด"}
        </button>
        <button type="button" aria-pressed={s.music} onClick={() => update({ music: !s.music })}>
          <MusicalNoteIcon aria-hidden />
          {s.music ? "เพลงเปิด" : "เพลงปิด"}
        </button>
        <button
          type="button"
          onClick={() =>
            document.fullscreenElement
              ? void document.exitFullscreen().catch(() => undefined)
              : void document.documentElement.requestFullscreen?.().catch(() => undefined)
          }
        >
          <ArrowsPointingOutIcon aria-hidden />
          เต็มจอ
        </button>
      </div>
      {level("ความดังทั้งหมด", "master")}
      {level("เพลง", "bgm")}
      {level("เอฟเฟกต์", "sfx")}
      {level("ฉากประกาศ", "show")}
    </div>
  );
}
