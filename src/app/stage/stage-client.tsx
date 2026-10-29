"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ExclamationTriangleIcon, SignalSlashIcon } from "@heroicons/react/24/solid";
import { nominees } from "@/data/nominees";
import { photoSrc } from "@/components/photo";
import { withBase } from "@/lib/base-path";
import { createLiveFeed, type LiveStatus } from "@/lib/live";
import type { EventState, TallySnapshot } from "@/lib/types";
import { fetchWithTimeout } from "@/lib/uuid";
import { Canvas } from "./canvas";
import type { QrProps } from "./qr-panel";
import { RaceView } from "./race-view";
import { Lobby, Pending } from "./scenes";
import s from "./stage.module.css";

const RESYNC_MS = 15_000;
const LOST_AFTER_MS = 10_000;
const COMMIT_MS = 250; // SPEC 5.5: buffer tally messages, re-render at most 4× a second

type Phase = "loading" | "ready" | "no_key" | "bad_key";

const newer = (a: TallySnapshot, b: TallySnapshot | undefined) =>
  !b || a.round > b.round || (a.round === b.round && a.seq > b.seq);

export function StageClient({ qr }: { qr: QrProps }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [state, setState] = useState<EventState | null>(null);
  const [clockOffset, setClockOffset] = useState(0);
  const [tallies, setTallies] = useState<Record<number, TallySnapshot>>({});
  const [live, setLive] = useState<LiveStatus>("connecting");
  const [lost, setLost] = useState(false);
  const [syncFailed, setSyncFailed] = useState(false);
  const [photos, setPhotos] = useState(0);
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
      const r = await fetchWithTimeout(withBase(`/api/stage/snapshot?k=${encodeURIComponent(k)}`), {}, 8_000);
      if (r.status === 401) {
        setPhase("bad_key");
        return;
      }
      if (!r.ok) throw new Error(String(r.status));
      const j = (await r.json()) as { state: EventState; tally: TallySnapshot | null };
      applyState(j.state);
      if (j.tally) applyTally(j.tally);
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
    const feed = createLiveFeed({ role: "stage", stageKey: k });
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
      <Canvas>
        <div className={s.message} role="status">
          <p>{qr.eventTitle}</p>
          <div className={s.progress}>
            <div className={s.progressFill} style={{ transform: `scaleX(${photos / nominees.length})` }} />
          </div>
          <p className={s.muted}>{syncFailed ? "เชื่อมต่อไม่สำเร็จ กำลังลองใหม่…" : "กำลังโหลด…"}</p>
        </div>
      </Canvas>
    );
  }

  const award = state.awards.find((a) => a.id === state.current_award_id) ?? null;

  return (
    <Canvas>
      {!award ? (
        <Lobby title={state.title} />
      ) : award.status === "pending" ? (
        <Pending award={award} qr={qr} />
      ) : (
        <RaceView
          // A new award or a reset (new round) starts a fresh race with the lanes fanning in
          key={`${award.id}:${award.round}`}
          award={award}
          tally={tallies[award.id]?.round === award.round ? tallies[award.id] : undefined}
          hide={state.hide_counts}
          qr={qr}
          clockOffset={clockOffset}
        />
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
