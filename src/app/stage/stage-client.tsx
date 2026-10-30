"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ExclamationTriangleIcon, SignalSlashIcon } from "@heroicons/react/24/solid";
import { nominees } from "@/data/nominees";
import { photoSrc } from "@/components/photo";
import { withBase } from "@/lib/base-path";
import { createStaffFeed, type LiveStatus } from "@/lib/live/staff";
import type { EventState, TallySnapshot } from "@/lib/types";
import { fetchWithTimeout } from "@/lib/uuid";
import { Canvas } from "./canvas";
import { cue, type MusicKey } from "./cues";
import { CountdownCues, OpenIntro } from "./moments";
import type { QrProps } from "./qr-panel";
import { RaceView } from "./race-view";
import { Hall, Reveal } from "./reveal";
import r from "./reveal.module.css";
import { Lobby, Pending } from "./scenes";
import { SoundControls, SoundNotice, StartGate } from "./sound/controls";
import { SoundDemo } from "./sound/demo";
import { useShow } from "./sound/use-show";
import s from "./stage.module.css";

const RESYNC_MS = 15_000;
const LOST_AFTER_MS = 10_000;
const COMMIT_MS = 250; // SPEC 5.5: buffer tally messages, re-render at most 4× a second

type Phase = "loading" | "ready" | "no_key" | "bad_key";

const newer = (a: TallySnapshot, b: TallySnapshot | undefined) =>
  !b || a.round > b.round || (a.round === b.round && a.seq > b.seq);

type Moments = { open: string | null; reveal: string | null; close: string | null };

// A scene plays its entrance only when this screen saw the change happen live; a screen that
// (re)loads mid-show lands on the current picture straight away (SPEC 6.3)
function detectMoments(before: EventState, after: EventState, m: Moments): Moments {
  const cur = after.awards.find((a) => a.id === after.current_award_id);
  const was = before.awards.find((a) => a.id === cur?.id);
  if (!cur || !was || was.round !== cur.round || was.status === cur.status) return m;
  const key = `${cur.id}:${cur.round}:${after.version}`;
  if (cur.status === "open" && was.status === "pending") return { ...m, open: key };
  if (cur.status === "revealed") return { ...m, reveal: key };
  if (cur.status === "closed" && was.status === "open") return { ...m, close: key };
  return m;
}

const noSubscribe = () => () => undefined;

// /stage?demo=sound opens the sound test page instead of the live screen
export function StageClient(props: { qr: QrProps; qrFallback: QrProps | null }) {
  const demo = useSyncExternalStore(
    noSubscribe,
    () => new URLSearchParams(window.location.search).get("demo") === "sound",
    () => false,
  );
  return demo ? <SoundDemo /> : <LiveStage {...props} />;
}

// The music bed that fits what the screen shows (SPEC 6.1)
function musicFor(state: EventState | null): MusicKey | null {
  if (!state) return null;
  const award = state.awards.find((a) => a.id === state.current_award_id);
  return !state.show_hall && award?.status === "open" ? "bgm_voting" : "bgm_lobby";
}

function LiveStage({ qr: qrMain, qrFallback }: { qr: QrProps; qrFallback: QrProps | null }) {
  const show = useShow();
  const [phase, setPhase] = useState<Phase>("loading");
  const [state, setState] = useState<EventState | null>(null);
  const [clockOffset, setClockOffset] = useState(0);
  const [tallies, setTallies] = useState<Record<number, TallySnapshot>>({});
  const [live, setLive] = useState<LiveStatus>("connecting");
  const [lost, setLost] = useState(false);
  const [syncFailed, setSyncFailed] = useState(false);
  const [photos, setPhotos] = useState(0);
  const [seenState, setSeenState] = useState<EventState | null>(null);
  const [moments, setMoments] = useState<Moments>({ open: null, reveal: null, close: null });
  const keyRef = useRef<string | null>(null);
  // Newest snapshot per award that has not been drawn yet
  const pending = useRef<Record<number, TallySnapshot>>({});

  const applyState = useCallback((next: EventState) => {
    setState((prev) => (prev && next.version < prev.version ? prev : next));
    setClockOffset(Date.parse(next.server_now) - Date.now());
  }, []);

  // Keep only the newest snapshot per award — publishes can arrive out of order (SPEC 1.1 #4)
  const applyTally = useCallback((t: TallySnapshot) => {
    if (newer(t, pending.current[t.award_id])) pending.current[t.award_id] = t;
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      const queued = Object.values(pending.current);
      if (!queued.length) return;
      pending.current = {};
      setTallies((prev) => {
        let out = prev;
        for (const q of queued) if (newer(q, out[q.award_id])) out = { ...out, [q.award_id]: q };
        return out;
      });
    }, COMMIT_MS);
    return () => clearInterval(t);
  }, []);

  const resync = useCallback(async () => {
    const k = keyRef.current;
    if (!k) return;
    try {
      const res = await fetchWithTimeout(withBase(`/api/stage/snapshot?k=${encodeURIComponent(k)}`), {}, 8_000);
      if (res.status === 401) {
        setPhase("bad_key");
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const j = (await res.json()) as { state: EventState; tally: TallySnapshot | null; hall?: TallySnapshot[] };
      applyState(j.state);
      if (j.tally) applyTally(j.tally);
      j.hall?.forEach(applyTally);
      setPhase("ready");
      setSyncFailed(false);
    } catch {
      setSyncFailed(true);
    }
  }, [applyState, applyTally]);

  // Preload + decode all 29 faces before the first scene (SPEC 5.5)
  useEffect(() => {
    let done = 0;
    for (const n of nominees) {
      const img = new Image();
      img.src = photoSrc(n.id, 120);
      img
        .decode()
        .catch(() => undefined) // a missing face must not block the show
        .then(() => setPhotos(++done));
    }
  }, []);

  useEffect(() => {
    const k = new URLSearchParams(window.location.search).get("k");
    if (!k) {
      queueMicrotask(() => setPhase("no_key"));
      return;
    }
    keyRef.current = k;
    void fetch(withBase("/api/health"), { cache: "no-store" }).catch(() => undefined); // wake Neon
    queueMicrotask(() => void resync());
    const feed = createStaffFeed({ role: "stage", stageKey: k });
    feed.onEvent(applyState);
    feed.onTally(applyTally);
    feed.onStatus(setLive);
    const t = setInterval(() => void resync(), RESYNC_MS);
    return () => {
      clearInterval(t);
      feed.close();
    };
  }, [applyState, applyTally, resync]);

  // Every (re)connect pulls the whole snapshot; a long outage turns the banner orange
  useEffect(() => {
    if (live === "connected") {
      queueMicrotask(() => {
        setLost(false);
        void resync();
      });
      return;
    }
    const t = setTimeout(() => setLost(true), LOST_AFTER_MS);
    return () => clearTimeout(t);
  }, [live, resync]);

  // Adjust-state-while-rendering: compare with the last state this screen drew
  if (state !== seenState) {
    setSeenState(state);
    if (state && seenState) {
      const next = detectMoments(seenState, state, moments);
      if (next !== moments) setMoments(next);
    }
  }

  useEffect(() => {
    if (moments.close) cue("sfx_close");
  }, [moments.close]);

  const music = musicFor(state);
  useEffect(() => {
    if (music) cue(music);
  }, [music]);

  // Sits on top of every scene below; the screen keeps loading behind it (SPEC 4.1, 6.3)
  const sound = show.engine ? (
    <>
      <SoundNotice engine={show.engine} />
      <SoundControls engine={show.engine} />
    </>
  ) : (
    <StartGate title={qrMain.eventTitle} onStart={show.start} />
  );

  if (phase === "no_key" || phase === "bad_key") {
    return (
      <Canvas>
        <div className={s.message}>
          <ExclamationTriangleIcon aria-hidden />
          <p>ลิงก์จอใหญ่ไม่ถูกต้อง ขอลิงก์จากผู้ดูแลระบบ</p>
        </div>
      </Canvas>
    );
  }

  if (!state || photos < nominees.length) {
    return (
      <Canvas overlay={sound}>
        <div className={s.message} role="status">
          <p>{qrMain.eventTitle}</p>
          <div className={s.progress}>
            <div className={s.progressFill} style={{ transform: `scaleX(${photos / nominees.length})` }} />
          </div>
          <p className={s.muted}>{syncFailed ? "เชื่อมต่อไม่สำเร็จ กำลังลองใหม่…" : "กำลังโหลด…"}</p>
        </div>
      </Canvas>
    );
  }

  const award = state.awards.find((a) => a.id === state.current_award_id) ?? null;
  const qr = state.qr_fallback && qrFallback ? qrFallback : qrMain;
  const tally = award && tallies[award.id]?.round === award.round ? tallies[award.id] : undefined;
  const momentFor = (k: string | null) => !!award && !!k && k.startsWith(`${award.id}:${award.round}:`);
  const revealed = award?.status === "revealed";
  const playReveal = revealed && momentFor(moments.reveal);

  return (
    <Canvas overlay={sound}>
      {state.show_hall ? (
        <Hall awards={state.awards} tallies={tallies} />
      ) : !award ? (
        <Lobby title={state.title} />
      ) : award.status === "pending" ? (
        <Pending award={award} qr={qr} />
      ) : (
        <>
          {(!revealed || playReveal) && (
            // Same wrapper element either way, so the race is not remounted when the reveal starts
            <div className={revealed ? r.raceOut : undefined}>
              <RaceView
                // A new award or a reset (new round) starts a fresh race with the lanes fanning in
                key={`${award.id}:${award.round}`}
                award={award}
                tally={tally}
                hide={state.hide_counts}
                qr={qr}
                clockOffset={clockOffset}
              />
            </div>
          )}
          {award.status === "open" && award.auto_close_at && (
            <CountdownCues key={award.auto_close_at} award={award} clockOffset={clockOffset} />
          )}
          {award.status === "open" && momentFor(moments.open) && (
            <OpenIntro
              key={moments.open}
              title={award.title}
              onDone={() => setMoments((m) => ({ ...m, open: null }))}
            />
          )}
          {revealed && <Reveal key={`${award.id}:${award.round}`} award={award} tally={tally} play={playReveal} />}
        </>
      )}

      {live !== "connected" && (
        <div role="status" className={lost ? `${s.banner} ${s.bannerLost}` : s.banner}>
          <SignalSlashIcon aria-hidden />
          {lost ? "การเชื่อมต่อหลุด ตัวเลขอาจยังไม่อัปเดต — กำลังลองใหม่" : "กำลังเชื่อมต่อใหม่…"}
        </div>
      )}
    </Canvas>
  );
}
