"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ExclamationTriangleIcon, SignalSlashIcon } from "@heroicons/react/24/solid";
import { nomineeById, nominees } from "@/data/nominees";
import { groupStyle } from "@/components/group";
import { photoSrc } from "@/components/photo";
import { withBase } from "@/lib/base-path";
import { createLiveFeed, type LiveStatus } from "@/lib/live";
import type { AwardStatus, EventState, TallySnapshot } from "@/lib/types";
import { fetchWithTimeout } from "@/lib/uuid";

// M1 stage: plain ranked list that updates live. The race layout + animation is M2.
const RESYNC_MS = 15_000;
const LOST_AFTER_MS = 10_000;

const STATUS_LABEL: Record<AwardStatus, string> = {
  pending: "รอเปิดโหวต",
  open: "เปิดโหวตอยู่",
  closed: "ปิดโหวตแล้ว",
  revealed: "ประกาศผลแล้ว",
};

type Phase = "loading" | "ready" | "no_key" | "bad_key";

export function StageClient() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [state, setState] = useState<EventState | null>(null);
  const [tallies, setTallies] = useState<Record<number, TallySnapshot>>({});
  const [live, setLive] = useState<LiveStatus>("connecting");
  const [lost, setLost] = useState(false);
  const [syncFailed, setSyncFailed] = useState(false);
  const keyRef = useRef<string | null>(null);

  const applyState = useCallback((s: EventState) => {
    setState((prev) => (prev && s.version < prev.version ? prev : s));
  }, []);

  // Keep only the newest snapshot per award — publishes can arrive out of order (SPEC 1.1 #4)
  const applyTally = useCallback((t: TallySnapshot) => {
    setTallies((prev) => {
      const cur = prev[t.award_id];
      if (cur && (t.round < cur.round || (t.round === cur.round && t.seq < cur.seq))) return prev;
      return { ...prev, [t.award_id]: t };
    });
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
      <Screen>
        <p className="m-auto flex items-center gap-4 text-4xl font-bold">
          <ExclamationTriangleIcon className="size-12 text-amber-400" aria-hidden />
          ลิงก์จอใหญ่ไม่ถูกต้อง ขอลิงก์จากผู้ดูแลระบบ
        </p>
      </Screen>
    );
  }

  if (!state) {
    return (
      <Screen>
        <p className="m-auto text-3xl text-slate-300" role="status">
          {syncFailed ? "เชื่อมต่อไม่สำเร็จ กำลังลองใหม่…" : "กำลังโหลด…"}
        </p>
      </Screen>
    );
  }

  const award = state.awards.find((a) => a.id === state.current_award_id) ?? null;
  const tally = award ? tallies[award.id] : undefined;
  const votes = new Map(tally?.counts ?? []);
  const ranked = nominees
    .map((n) => ({ n, v: votes.get(n.id) ?? 0 }))
    .sort((a, b) => b.v - a.v || a.n.id - b.n.id); // ties keep nominee order (SPEC 5.1)
  const max = Math.max(1, ...ranked.map((r) => r.v));
  const hide = state.hide_counts;

  return (
    <Screen>
      <header className="flex items-end justify-between px-12 pt-8">
        <div>
          <p className="text-2xl text-slate-400">{state.title}</p>
          <h1 className="text-6xl font-extrabold">{award ? award.title : "รอพิธีกรเปิดรางวัลแรก"}</h1>
        </div>
        {award && (
          <div className="text-right">
            <p className="text-3xl font-bold text-amber-300">{STATUS_LABEL[award.status]}</p>
            <p className="text-4xl font-extrabold tabular-nums">
              เสียงรวม {(tally?.total ?? 0).toLocaleString("th-TH")}
            </p>
          </div>
        )}
      </header>

      {award && (
        <ol className="grid flex-1 grid-flow-col grid-cols-2 grid-rows-[repeat(15,minmax(0,1fr))] gap-x-10 gap-y-1 px-12 py-6">
          {ranked.map(({ n, v }) => {
            const rank = 1 + ranked.filter((r) => r.v > v).length; // shared rank on ties: 1, 1, 3
            const gs = groupStyle[nomineeById.get(n.id)!.group];
            return (
              <li key={n.id} className="flex min-h-0 items-center gap-3">
                <span className="w-10 text-right text-2xl font-bold tabular-nums text-slate-400">{rank}</span>
                {/* eslint-disable-next-line @next/next/no-img-element -- pre-sized WebP, no optimizer (SPEC 4.0) */}
                <img
                  src={photoSrc(n.id, 120)}
                  width={39}
                  height={52}
                  alt=""
                  className="h-full max-h-[52px] w-auto rounded object-cover object-[center_30%]"
                />
                <span className="w-44 truncate text-2xl font-bold">{n.nickname}</span>
                <span className={`rounded px-2 text-sm font-bold ${gs.chip}`}>{n.group}</span>
                <span className="relative h-5 flex-1 overflow-hidden rounded bg-slate-800">
                  <span
                    className={`absolute inset-y-0 left-0 w-full origin-left rounded ${gs.bar} transition-transform duration-300`}
                    style={{ transform: `scaleX(${hide ? 1 : v / max})` }}
                  />
                </span>
                <span className="w-16 text-right text-3xl font-extrabold tabular-nums">
                  {hide ? "?" : v.toLocaleString("th-TH")}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      {live !== "connected" && (
        <div
          role="status"
          className={`fixed bottom-4 right-4 flex items-center gap-2 rounded-lg px-4 py-2 text-xl ${
            lost ? "bg-orange-500 text-white" : "bg-slate-800/90 text-white"
          }`}
        >
          <SignalSlashIcon className="size-6" aria-hidden />
          {lost ? "การเชื่อมต่อหลุด ตัวเลขอาจยังไม่อัปเดต — กำลังลองใหม่" : "กำลังเชื่อมต่อใหม่…"}
        </div>
      )}
    </Screen>
  );
}

function Screen({ children }: { children: React.ReactNode }) {
  return <main className="flex h-screen flex-col overflow-hidden bg-slate-950 text-white">{children}</main>;
}
