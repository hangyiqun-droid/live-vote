"use client";

import { useEffect, useRef, useState } from "react";
import { MicrophoneIcon, PlayIcon, StopIcon } from "@heroicons/react/24/solid";
import { nominees } from "@/data/nominees";
import { cue, type CueKey } from "../cues";
import { rankRows, raceSound } from "../race";
import { timeline } from "../reveal";
import { SoundControls, SoundNotice, StartGate, useEngineState } from "./controls";
import type { SoundEngine } from "./engine";
import c from "./sound.module.css";
import { useShow } from "./use-show";

// /stage?demo=sound — lets the maintainer hear every sound and the vote-storm throttling without a live
// event, and record the mix to a file. Uses no data from the server.

const SINGLE: [CueKey, string][] = [
  ["sfx_tick", "โหวตเข้า 1 เสียง"],
  ["sfx_burst", "โหวตเข้ารัว"],
  ["sfx_overtake", "แซงอันดับ"],
  ["sfx_leader", "ขึ้นที่ 1 คนใหม่"],
  ["sfx_chase", "ไล่มาติด"],
  ["sfx_open", "เปิดรางวัล"],
  ["sfx_count", "นับถอยหลัง"],
  ["sfx_close", "ปิดโหวต"],
  ["sfx_drumroll", "กลองรัว"],
  ["sfx_place", "เปิดอันดับ 3 / 2"],
  ["sfx_reveal", "ผู้ชนะขึ้น"],
  ["sfx_applause", "ปรบมือ"],
];

const FAVOURITES = [3, 7, 12, 18, 25, 9]; // a few front runners so the race has overtakes

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new Error("stopped"));
    });
  });

// Same commit rhythm and the same cue rules as the real race screen (race-view.tsx)
async function voteStorm(total: number, ms: number, signal: AbortSignal) {
  const times = Array.from({ length: total }, () => Math.random() * ms).sort((a, b) => a - b);
  const counts = new Map<number, number>();
  let prev = rankRows(counts);
  let i = 0;
  for (let t = 250; i < times.length; t += 250) {
    await sleep(250, signal);
    while (i < times.length && times[i] < t) {
      const id =
        Math.random() < 0.75
          ? FAVOURITES[Math.floor(Math.random() * FAVOURITES.length)]
          : nominees[Math.floor(Math.random() * nominees.length)].id;
      counts.set(id, (counts.get(id) ?? 0) + 1);
      i++;
    }
    const next = rankRows(counts);
    const s = raceSound(prev, next, false);
    if (s.votes) cue("sfx_tick", { votes: s.votes });
    if (s.moment) cue(s.moment);
    prev = next;
  }
}

async function reveal(signal: AbortSignal) {
  const places = [
    { rank: 3, id: 12, votes: 9, wonTie: false },
    { rank: 2, id: 7, votes: 14, wonTie: false },
    { rank: 1, id: 3, votes: 21, wonTie: false },
  ];
  let at = 0;
  for (const b of timeline(places)) {
    await sleep(b.at - at, signal);
    at = b.at;
    b.cues?.forEach((k) => cue(k));
  }
  await sleep(7000, signal);
}

// A whole award in ~50 s: lobby → open → votes → last 10 s → close → reveal
async function wholeAward(signal: AbortSignal) {
  cue("bgm_lobby");
  await sleep(3000, signal);
  cue("bgm_voting");
  cue("sfx_open");
  await sleep(2500, signal);
  const storm = voteStorm(100, 16_000, signal);
  await sleep(6000, signal);
  for (let left = 10; left > 0; left--) {
    cue("sfx_count", { left });
    await sleep(1000, signal);
  }
  await storm.catch(() => undefined);
  cue("sfx_close");
  cue("bgm_lobby");
  await sleep(3000, signal);
  await reveal(signal);
}

const SCENARIOS = {
  storm10: { label: "โหวตรัว 100 เสียงใน 10 วิ (มีเพลงเปิดโหวต)", run: (s: AbortSignal) => (cue("bgm_voting"), voteStorm(100, 10_000, s)) },
  storm1: { label: "100 เสียงใน 1 วิ (กรณีหนักสุด)", run: (s: AbortSignal) => (cue("bgm_voting"), voteStorm(100, 1000, s)) },
  reveal: { label: "ฉากประกาศผล 3 → 2 → 1", run: (s: AbortSignal) => (cue("bgm_lobby"), reveal(s)) },
  award: { label: "ทั้งรางวัล: lobby → เปิด → โหวต → นับถอยหลัง → ปิด → ประกาศ (~50 วิ)", run: wholeAward },
} as const;
type Scenario = keyof typeof SCENARIOS;

type Recorder = { stop: () => Promise<Blob> };

function record(engine: SoundEngine): Recorder {
  const dest = engine.ctx.createMediaStreamDestination();
  engine.out.connect(dest);
  const rec = new MediaRecorder(dest.stream, { mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 160_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => chunks.push(e.data);
  rec.start(500);
  return {
    stop: () =>
      new Promise((resolve) => {
        rec.onstop = () => {
          engine.out.disconnect(dest);
          resolve(new Blob(chunks, { type: "audio/webm" }));
        };
        rec.stop();
      }),
  };
}

declare global {
  interface Window {
    eventSoundDemo?: { run: (s: Scenario) => Promise<void>; record: () => void; stop: () => Promise<string> };
  }
}

export function SoundDemo() {
  const { engine, start } = useShow();
  const state = useEngineState(engine);
  const [running, setRunning] = useState<Scenario | null>(null);
  const [rec, setRec] = useState<Recorder | null>(null);
  const [file, setFile] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const run = async (k: Scenario) => {
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    setRunning(k);
    try {
      await SCENARIOS[k].run(ac.signal);
    } catch {
      /* stopped */
    }
    if (abort.current === ac) setRunning(null);
  };

  const startRec = () => {
    if (!engine || rec) return;
    setFile(null);
    setRec(record(engine));
  };
  const stopRec = async () => {
    if (!rec) return null;
    const blob = await rec.stop();
    setRec(null);
    setFile(URL.createObjectURL(blob));
    return blob;
  };

  // Hook for scripts/record-sound.ts (headless Chrome renders the evidence recording)
  const api = useRef({ run, startRec, stopRec });
  useEffect(() => {
    api.current = { run, startRec, stopRec };
  });
  useEffect(() => {
    window.eventSoundDemo = {
      run: (s) => api.current.run(s),
      record: () => api.current.startRec(),
      stop: async () => {
        const blob = await api.current.stopRec();
        if (!blob) return "";
        const buf = new Uint8Array(await blob.arrayBuffer());
        let bin = "";
        for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        return btoa(bin);
      },
    };
    return () => {
      delete window.eventSoundDemo;
    };
  }, []);

  if (!engine) return <StartGate title="ทดสอบเสียงจอใหญ่" onStart={start} />;

  return (
    <main className={c.demo}>
      <h1>ทดสอบเสียงจอใหญ่</h1>
      <p className={c.demoStatus} role="status">
        {state === "running" ? "เสียงพร้อม" : state === "loading" ? "กำลังโหลดเสียง…" : "เสียงยังไม่เปิด"}
        {running && ` · กำลังเล่น: ${SCENARIOS[running].label}`}
      </p>

      <section>
        <h2>สถานการณ์จำลอง</h2>
        <div className={c.demoGrid}>
          {(Object.keys(SCENARIOS) as Scenario[]).map((k) => (
            <button key={k} type="button" onClick={() => void run(k)} disabled={state !== "running"}>
              <PlayIcon aria-hidden />
              {SCENARIOS[k].label}
            </button>
          ))}
          <button type="button" onClick={() => abort.current?.abort()} disabled={!running}>
            <StopIcon aria-hidden />
            หยุด
          </button>
        </div>
      </section>

      <section>
        <h2>เพลงพื้นหลัง</h2>
        <div className={c.demoGrid}>
          <button type="button" onClick={() => cue("bgm_lobby")}>เพลงรอ (lobby)</button>
          <button type="button" onClick={() => cue("bgm_voting")}>เพลงเปิดโหวต</button>
          <button type="button" onClick={() => cue("bgm_off")}>ปิดเพลง</button>
        </div>
      </section>

      <section>
        <h2>ทีละเสียง</h2>
        <div className={c.demoGrid}>
          {SINGLE.map(([k, label]) => (
            <button key={k} type="button" onClick={() => cue(k)} disabled={state !== "running"}>
              {label}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2>อัดเสียงเป็นไฟล์</h2>
        <div className={c.demoGrid}>
          <button type="button" onClick={rec ? () => void stopRec() : startRec} disabled={state !== "running"}>
            {rec ? <StopIcon aria-hidden /> : <MicrophoneIcon aria-hidden />}
            {rec ? "หยุดอัด" : "เริ่มอัด"}
          </button>
          {file && (
            <a href={file} download="event-stage-sound.webm">
              ดาวน์โหลดไฟล์ที่อัด
            </a>
          )}
        </div>
      </section>

      <SoundNotice engine={engine} />
      <SoundControls engine={engine} />
    </main>
  );
}
