"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowPathIcon,
  CheckCircleIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  NoSymbolIcon,
  SignalSlashIcon,
  TvIcon,
} from "@heroicons/react/24/solid";
import { GROUPS, nomineeById, nominees, type Nominee } from "@/data/nominees";
import { groupStyle } from "@/components/group";
import { photoSrc, photoSrcSet } from "@/components/photo";
import { withBase } from "@/lib/base-path";
import { createLiveFeed, type LiveFeed, type LiveStatus } from "@/lib/live";
import type { AwardState, EventState } from "@/lib/types";
import { fetchWithTimeout, uuid4 } from "@/lib/uuid";
import { loadBallot, loadDeviceId, saveBallot, saveDeviceId, type Ballot } from "./vote-store";

// 29 faces fit one screen (SPEC 4.2). Tiles are ~1/5 of the width, but on a tall phone cover-fit
// scales the photo up to the tile's height, so the files are picked as if ~1/4 wide.
const GRID_SIZES = "(max-width: 480px) calc((100vw - 16px) / 4), 116px";
// Realtime is the main path; these only catch what it missed (SPEC 4.2). A socket can die silently
// while Ably still says "connected" (phones do this), so a check runs even then: 4 s keeps a silent
// socket to ~5 s stale, and 100 phones make ~25 light reads/s on /api/state (no counts, no cache).
// Each wait gets ±20% so a room of phones does not poll in step.
const POLL_CONNECTED_MS = 4_000;
const POLL_DOWN_MS = 4_000;
const POLL_RETRY_MS = 2_000;
const TICK_GAP_MS = 300; // focus + visibilitychange + pageshow arrive together

type View = { s: EventState; offset: number };
type SendError = "network" | "invalid_nominee" | null;
// A pick belongs to one award + round: when the MC moves on it must never follow to the next one
type Pick = { key: string; nomineeId: number };
const awardKey = (a: AwardState) => `${a.id}:${a.round}`;

// Screen stays on while the page is in front, where the browser allows it (best effort)
const keepAwake = () => void navigator.wakeLock?.request("screen").catch(() => undefined);

export function VoteClient() {
  const [view, setView] = useState<View | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [live, setLive] = useState<LiveStatus>("connecting");
  const [now, setNow] = useState(0);
  const [selected, setSelected] = useState<Pick | null>(null);
  const [dismissedPending, setDismissedPending] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<SendError>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [ballotVersion, setBallotVersion] = useState(0);
  const feed = useRef<LiveFeed | null>(null);

  const applyState = useCallback((s: EventState) => {
    setView((prev) => {
      if (prev && s.version < prev.s.version) return prev; // out-of-order message
      return { s, offset: Date.parse(s.server_now) - Date.now() };
    });
    setNow(Date.now());
  }, []);

  const fetchState = useCallback(async () => {
    try {
      const r = await fetchWithTimeout(withBase("/api/state"), {}, 8_000);
      if (!r.ok) throw new Error(String(r.status));
      applyState(await r.json());
      setLoadFailed(false);
      return true;
    } catch {
      setLoadFailed(true);
      return false;
    }
  }, [applyState]);

  // Device id, realtime feed
  useEffect(() => {
    (async () => {
      const local = loadDeviceId();
      try {
        const r = await fetchWithTimeout(withBase("/api/device"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ device_id: local }),
        });
        const j = (await r.json()) as { device_id: string };
        saveDeviceId(j.device_id);
        setDeviceId(j.device_id);
      } catch {
        setDeviceId(local);
      }
    })();
    const f = createLiveFeed();
    feed.current = f;
    f.onEvent(applyState);
    f.onStatus(setLive);
    return () => f.close();
  }, [applyState]);

  // State check: at once on every status change (catches up after a reconnect) and on every
  // wake-up, then on a timer. A failed check retries soon: the network is often not back yet
  // in the first moment after unlocking a phone. Never reloads the page.
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let last = 0;
    const tick = async () => {
      const at = Date.now();
      if (at - last < TICK_GAP_MS) return;
      last = at;
      clearTimeout(timer);
      // A hidden page stops checking; `wake` restarts it the moment the page is back in front
      if (document.visibilityState === "hidden") return;
      const ok = await fetchState();
      if (stopped || last !== at) return; // a newer tick owns the timer
      const wait = !ok ? POLL_RETRY_MS : live === "connected" ? POLL_CONNECTED_MS : POLL_DOWN_MS;
      timer = setTimeout(() => void tick(), wait * (0.8 + Math.random() * 0.4));
    };
    const wake = () => {
      if (document.visibilityState === "hidden") return;
      feed.current?.reconnect();
      keepAwake();
      void tick();
    };
    queueMicrotask(() => void tick());
    keepAwake();
    document.addEventListener("visibilitychange", wake);
    for (const e of ["focus", "online", "pageshow"]) window.addEventListener(e, wake);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
      for (const e of ["focus", "online", "pageshow"]) window.removeEventListener(e, wake);
    };
  }, [live, fetchState]);

  const s = view?.s ?? null;
  const openAward = s?.awards.find((a) => a.status === "open") ?? null;
  const deadline = openAward?.auto_close_at ? Date.parse(openAward.auto_close_at) : null;
  const serverNow = now + (view?.offset ?? 0);
  const expired = deadline !== null && now > 0 && serverNow >= deadline;

  // Countdown clock
  useEffect(() => {
    if (deadline === null) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [deadline]);

  // Time ran out on the phone: ask the server, which closes the award and tells everyone
  useEffect(() => {
    if (expired) queueMicrotask(() => void fetchState());
  }, [expired, fetchState]);

  const activeAward = openAward && !expired ? openAward : null;
  const ballot = useMemo<Ballot | null>(
    () => (activeAward ? loadBallot(activeAward.id, activeAward.round) : null),
    // ballotVersion re-reads localStorage after every save
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeAward?.id, activeAward?.round, ballotVersion],
  );

  const key = activeAward ? awardKey(activeAward) : null;
  const pick =
    selected?.key === key
      ? selected.nomineeId
      : ballot?.outcome === "pending" && dismissedPending !== key
        ? ballot.nomineeId
        : null;

  const send = useCallback(
    async (award: AwardState, nomineeId: number) => {
      let b = loadBallot(award.id, award.round);
      // Same person again = same request_id (a lost reply is never counted twice)
      if (!b || b.nomineeId !== nomineeId) {
        b = { nomineeId, requestId: uuid4(), outcome: "pending" };
        saveBallot(award.id, award.round, b);
      }
      setSending(true);
      setSendError(null);
      try {
        const r = await fetchWithTimeout(withBase("/api/vote"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            award_id: award.id,
            nominee_id: nomineeId,
            request_id: b.requestId,
            device_id: deviceId ?? loadDeviceId() ?? undefined,
          }),
        });
        if (r.status === 429 || r.status >= 500) throw new Error(String(r.status));
        const j = (await r.json()) as { result: string; device_id?: string };
        if (j.device_id) {
          saveDeviceId(j.device_id);
          setDeviceId(j.device_id);
        }
        if (j.result === "counted" || j.result === "already_voted") {
          saveBallot(award.id, award.round, { ...b, outcome: j.result });
          setSelected(null);
          if (j.result === "counted") navigator.vibrate?.(60);
        } else if (j.result === "not_open") {
          setSelected(null);
          await fetchState();
        } else if (j.result === "invalid_nominee") {
          setSendError("invalid_nominee");
        } else {
          throw new Error(j.result);
        }
      } catch {
        setSendError("network");
      } finally {
        setSending(false);
        setBallotVersion((v) => v + 1);
      }
    },
    [deviceId, fetchState],
  );

  const choose = (id: number) => {
    if (!key) return;
    keepAwake(); // Safari only grants this from a tap
    setSelected({ key, nomineeId: id });
    setSendError(null);
  };
  const cancel = () => {
    setSelected(null);
    setDismissedPending(key);
    setSendError(null);
  };

  const offline = live === "disconnected" || live === "failed" || loadFailed;
  const voting = activeAward !== null && (!ballot || ballot.outcome === "pending");
  const fullGrid = voting || (!s && !loadFailed);

  return (
    <main className={`mx-auto flex w-full max-w-[480px] flex-1 flex-col ${fullGrid ? "vote-screen" : "pb-10"}`}>
      <Header state={s} award={activeAward} deadline={deadline} serverNow={serverNow} voting={voting} />

      {offline && s && (
        <div className="mx-1 mb-1 flex items-center gap-2 rounded-lg bg-slate-200 px-3 py-1 text-sm text-slate-700">
          <SignalSlashIcon className="size-5 shrink-0" aria-hidden />
          กำลังเชื่อมต่อใหม่…
        </div>
      )}

      {!s && loadFailed && (
        <div role="alert" className="mx-3 rounded-xl border border-red-200 bg-red-50 p-4 text-red-800">
          <p className="flex items-start gap-2">
            <ExclamationTriangleIcon className="mt-0.5 size-5 shrink-0" aria-hidden />
            โหลดข้อมูลไม่สำเร็จ สัญญาณอาจไม่ดี ลองใหม่อีกครั้ง
          </p>
          <button
            type="button"
            onClick={() => void fetchState()}
            className="mt-3 inline-flex min-h-12 items-center gap-2 rounded-lg bg-red-700 px-5 font-bold text-white"
          >
            <ArrowPathIcon className="size-5" aria-hidden />
            ลองใหม่
          </button>
        </div>
      )}

      {!s && !loadFailed && <SkeletonGrid />}

      {s && activeAward && ballot && ballot.outcome !== "pending" && (
        <Done ballot={ballot} />
      )}

      {voting && <Grid selected={pick} onChoose={choose} />}

      {s && !activeAward && <Waiting state={s} />}

      {activeAward && voting && pick !== null && (
        <ConfirmSheet
          nominee={nomineeById.get(pick)!}
          sending={sending}
          error={sendError}
          onConfirm={() => void send(activeAward, pick)}
          onCancel={cancel}
        />
      )}
    </main>
  );
}

function Header({
  state,
  award,
  deadline,
  serverNow,
  voting,
}: {
  state: EventState | null;
  award: AwardState | null;
  deadline: number | null;
  serverNow: number;
  voting: boolean;
}) {
  const left = award && deadline ? Math.max(0, Math.ceil((deadline - serverNow) / 1000)) : null;
  return (
    <header
      className={`bg-slate-900 text-white ${
        voting ? "px-2 pb-1.5 pt-[max(0.375rem,env(safe-area-inset-top))]" : "sticky top-0 z-10 mb-3 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]"
      }`}
    >
      {!voting && <p className="text-xs text-slate-300">{state?.title ?? "Founders Awards Night 2026"}</p>}
      <div className="flex items-center justify-between gap-2">
        <h1 className={`font-extrabold leading-tight ${voting ? "text-[15px]" : "text-xl"}`}>{award ? award.title : "โหวตรางวัล"}</h1>
        {left !== null && (
          <p
            className={`flex shrink-0 items-center gap-1 text-lg font-bold tabular-nums ${left <= 10 ? "text-amber-300" : ""}`}
            aria-label={`เหลือเวลา ${left} วินาที`}
          >
            <ClockIcon className="size-5" aria-hidden />
            {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
          </p>
        )}
      </div>
      {voting && (
        <div className="mt-0.5 flex items-center justify-between gap-2 text-xs text-slate-300">
          <p>แตะรูปคนที่อยากโหวตให้</p>
          <ul className="flex shrink-0 gap-1.5" aria-hidden>
            {GROUPS.map((g) => (
              <li key={g} className="flex items-center gap-0.5 text-[9px] font-bold">
                <span className={`size-2 rounded-sm ${groupStyle[g].bar}`} />
                {g}
              </li>
            ))}
          </ul>
        </div>
      )}
    </header>
  );
}

// Same order as the group frames read: every group stays together without section headings
const byGroup = GROUPS.flatMap((g) => nominees.filter((n) => n.group === g));

// 5 × 6 cells share whatever height is left under the header, so the page never scrolls (SPEC 4.2)
const GRID_CLASS = "grid min-h-0 flex-1 grid-cols-5 grid-rows-6 gap-1 p-1";

function SkeletonGrid() {
  return (
    <div className={GRID_CLASS} aria-busy="true" aria-label="กำลังโหลด">
      {byGroup.map((n) => (
        <div key={n.id} className={`rounded-lg border-2 ${groupStyle[n.group].frame} ${groupStyle[n.group].soft} motion-safe:animate-pulse`} />
      ))}
    </div>
  );
}

function Grid({ selected, onChoose }: { selected: number | null; onChoose: (id: number) => void }) {
  return (
    <ul className={GRID_CLASS}>
      {byGroup.map((n) => (
        <li key={n.id} className="min-h-0 min-w-0">
          <Tile nominee={n} selected={selected === n.id} onChoose={onChoose} />
        </li>
      ))}
    </ul>
  );
}

function Tile({
  nominee: n,
  selected,
  onChoose,
}: {
  nominee: Nominee;
  selected: boolean;
  onChoose: (id: number) => void;
}) {
  const gs = groupStyle[n.group];
  return (
    <button
      type="button"
      onClick={() => onChoose(n.id)}
      aria-pressed={selected}
      aria-label={`${n.nickname} (${n.firstName}) กลุ่ม ${n.group}`}
      className={`flex size-full flex-col overflow-hidden rounded-lg border-2 bg-white text-center ${
        selected ? "border-amber-400 ring-2 ring-amber-400" : gs.frame
      }`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- pre-sized WebP + srcset, no optimizer (SPEC 4.0) */}
      <img
        src={photoSrc(n.id, 240)}
        srcSet={photoSrcSet(n.id)}
        sizes={GRID_SIZES}
        width={120}
        height={160}
        alt=""
        decoding="async"
        className={`min-h-0 w-full flex-1 object-cover object-[center_30%] ${gs.soft}`}
      />
      <span className="block w-full shrink-0 truncate px-0.5 text-xs font-bold leading-[1.4]">{n.nickname}</span>
    </button>
  );
}

function ConfirmSheet({
  nominee: n,
  sending,
  error,
  onConfirm,
  onCancel,
}: {
  nominee: Nominee;
  sending: boolean;
  error: SendError;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const gs = groupStyle[n.group];
  return (
    <div className="fixed inset-0 z-20 flex items-end bg-slate-900/50" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <div className="mx-auto w-full max-w-[480px] rounded-t-2xl bg-white px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-5 shadow-2xl motion-safe:animate-[sheet-up_200ms_ease-out]">
        {/* eslint-disable-next-line @next/next/no-img-element -- pre-sized WebP (SPEC 4.2) */}
        <img
          src={photoSrc(n.id, 360)}
          srcSet={photoSrcSet(n.id, [240, 360])}
          sizes="180px"
          width={180}
          height={240}
          alt={`${n.nickname} กลุ่ม ${n.group}`}
          className={`mx-auto aspect-[3/4] w-[180px] rounded-xl object-cover object-[center_30%] ${gs.soft}`}
        />
        <p id="confirm-title" className="mt-4 text-center text-lg leading-snug">
          โหวตให้ <strong className="text-2xl">{n.nickname}</strong> ({n.firstName})
          <br />
          กลุ่ม <span className={`rounded px-1.5 font-bold ${gs.chip}`}>{n.group}</span> ใช่ไหม
        </p>
        <div className="mt-5 grid gap-3">
          <button
            type="button"
            onClick={onConfirm}
            disabled={sending}
            aria-describedby={error ? "send-error" : undefined}
            className="flex min-h-14 items-center justify-center gap-2 rounded-xl bg-slate-900 text-lg font-bold text-white disabled:opacity-70"
          >
            {sending ? (
              <>
                <ArrowPathIcon className="size-5 motion-safe:animate-spin" aria-hidden />
                กำลังส่ง…
              </>
            ) : error === "network" ? (
              "ลองใหม่"
            ) : (
              "ยืนยันโหวต"
            )}
          </button>
          {error && (
            <p id="send-error" role="alert" className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
              <ExclamationTriangleIcon className="mt-0.5 size-5 shrink-0" aria-hidden />
              {error === "network"
                ? "ส่งไม่สำเร็จ สัญญาณอาจไม่ดี กดลองใหม่ได้เลย ระบบไม่นับซ้ำ"
                : "เลือกคนนี้ไม่ได้ ลองเลือกคนอื่นอีกครั้ง"}
            </p>
          )}
          <button
            type="button"
            onClick={onCancel}
            disabled={sending}
            className="min-h-12 rounded-xl border border-slate-300 font-bold text-slate-700 disabled:opacity-50"
          >
            เลือกใหม่
          </button>
        </div>
      </div>
    </div>
  );
}

function Done({ ballot }: { ballot: Ballot }) {
  const n = nomineeById.get(ballot.nomineeId);
  if (ballot.outcome === "already_voted") {
    return (
      <Message icon={<CheckCircleIcon className="size-14 text-slate-500" aria-hidden />}>
        เครื่องนี้โหวตรางวัลนี้ไปแล้ว ขอบคุณครับ
        <StayHint />
      </Message>
    );
  }
  return (
    <div className="flex flex-col items-center px-6 pt-8 text-center">
      <CheckCircleIcon className="size-20 text-emerald-600 motion-safe:animate-[pop_400ms_ease-out]" aria-hidden />
      <p className="mt-3 text-2xl font-extrabold">ส่งแล้ว! ดูคะแนนบนจอใหญ่ได้เลย</p>
      {n && (
        <div className="mt-6 flex items-center gap-3 rounded-xl bg-white p-3 shadow-sm">
          {/* eslint-disable-next-line @next/next/no-img-element -- pre-sized WebP (SPEC 4.2) */}
          <img
            src={photoSrc(n.id, 240)}
            srcSet={photoSrcSet(n.id, [120, 240, 360])}
            sizes="72px"
            width={72}
            height={96}
            alt=""
            className="h-24 w-[72px] rounded-lg object-cover object-[center_30%]"
          />
          <p className="text-left">
            คุณโหวต <strong className="text-xl">{n.nickname}</strong>
            <br />
            <span className={`rounded px-1.5 text-xs font-bold ${groupStyle[n.group].chip}`}>{n.group}</span>
          </p>
        </div>
      )}
      <p className="mt-6 text-base text-slate-600">{STAY_HINT}</p>
    </div>
  );
}

function Waiting({ state }: { state: EventState }) {
  const current = state.awards.find((a) => a.id === state.current_award_id) ?? null;
  if (current?.status === "closed") {
    return (
      <Message icon={<NoSymbolIcon className="size-14 text-slate-500" aria-hidden />}>
        ปิดโหวตรางวัลนี้แล้ว ขอบคุณที่ร่วมสนุก รอลุ้นผลบนจอใหญ่
        <StayHint />
      </Message>
    );
  }
  if (current?.status === "revealed") {
    return (
      <Message icon={<TvIcon className="size-14 text-slate-500" aria-hidden />}>
        ประกาศผลแล้ว ดูบนจอใหญ่
        <StayHint />
      </Message>
    );
  }
  const next = current?.status === "pending" ? current : state.awards.find((a) => a.status === "pending");
  return (
    <Message icon={<ClockIcon className="size-14 text-slate-500" aria-hidden />}>
      รางวัลนี้ยังไม่เปิดโหวต รอพิธีกรเปิดแล้วหน้านี้จะเปลี่ยนเอง
      {next && (
        <span className="mt-4 block text-base font-normal text-slate-600">
          รางวัลถัดไป: <strong>{next.title}</strong>
        </span>
      )}
    </Message>
  );
}

const STAY_HINT = "เปิดหน้านี้ค้างไว้ รางวัลถัดไปจะขึ้นเอง ไม่ต้องสแกนใหม่";

function StayHint() {
  return <span className="mt-4 block text-base font-normal text-slate-600">{STAY_HINT}</span>;
}

function Message({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 pt-10 text-center" role="status">
      {icon}
      <p className="mt-4 text-xl font-bold leading-relaxed">{children}</p>
    </div>
  );
}
