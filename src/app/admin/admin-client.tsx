"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowPathIcon,
  ArrowRightStartOnRectangleIcon,
  ArrowUturnLeftIcon,
  ChatBubbleLeftRightIcon,
  CheckIcon,
  ClipboardDocumentIcon,
  ExclamationTriangleIcon,
  EyeSlashIcon,
  HomeIcon,
  QrCodeIcon,
  SignalSlashIcon,
  TrophyIcon,
  TvIcon,
  UsersIcon,
} from "@heroicons/react/24/solid";
import type { AdminAction } from "@/lib/admin-actions";
import { withBase } from "@/lib/base-path";
import { createStaffFeed, type LiveStatus } from "@/lib/live/staff";
import type { AdminOverview, AdminTally, EventState, TallySnapshot } from "@/lib/types";
import { fetchWithTimeout } from "@/lib/uuid";
import { AwardCard } from "./award-card";
import { HoldButton } from "./hold-button";
import { Login } from "./login";
import { actionError } from "./messages";
import a from "./admin.module.css";

const POLL_MS = 10_000;

type Phase = "checking" | "login" | "ready" | "down";
type Overview = { state: EventState; tallies: Record<number, AdminTally>; stagePath: string | null; scans: number | null };
type Raw = AdminOverview & { stage_path?: string | null; scans?: number };
type Failure = { message: string; retry: { act: AdminAction; label: string } | null };
type Undo = { label: string; act: AdminAction; undoLabel: string };

const newer = (t: TallySnapshot, have: TallySnapshot | undefined) =>
  !have || t.round > have.round || (t.round === have.round && t.seq > have.seq);

function toOverview(j: Raw, prevStage: string | null, prevScans: number | null): Overview {
  return {
    state: j.state,
    tallies: Object.fromEntries(j.tallies.map((t) => [t.award_id, t])),
    stagePath: j.stage_path ?? prevStage,
    scans: j.scans ?? prevScans,
  };
}

// The opposite button for "กดผิด". Reset and +30 s have none —
// reset is guarded by typing the award name instead.
function inverse(act: AdminAction, before: EventState): AdminAction | null {
  const title = (id: number) => before.awards.find((x) => x.id === id);
  switch (act.action) {
    case "show":
    case "lobby":
      return before.current_award_id ? { action: "show", award_id: before.current_award_id } : { action: "lobby" };
    case "open":
    case "reopen":
      return { action: "close", award_id: act.award_id };
    case "close":
      return { action: "reopen", award_id: act.award_id };
    case "reveal":
      return { action: "unreveal", award_id: act.award_id };
    case "unreveal":
      return { action: "reveal", award_id: act.award_id };
    case "hide":
    case "hall":
    case "qr_fallback":
    case "greetings":
      return { action: act.action, on: !act.on };
    case "rename": {
      const old = title(act.award_id);
      return old ? { action: "rename", award_id: old.id, title: old.title, subtitle: old.subtitle ?? "" } : null;
    }
    default:
      return null;
  }
}

export function AdminClient({ version, hasFallback }: { version: string; hasFallback: boolean }) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [ov, setOv] = useState<Overview | null>(null);
  const [live, setLive] = useState<LiveStatus>("connecting");
  const [screens, setScreens] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [undo, setUndo] = useState<Undo | null>(null);
  const [clockOffset, setClockOffset] = useState(0);
  const [copied, setCopied] = useState(false);
  const stageRef = useRef<string | null>(null);
  const scansRef = useRef<number | null>(null);

  const accept = useCallback((j: Raw) => {
    const next = toOverview(j, stageRef.current, scansRef.current);
    scansRef.current = next.scans;
    stageRef.current = next.stagePath;
    setOv((prev) => (prev && next.state.version < prev.state.version ? { ...prev, tallies: next.tallies } : next));
    setClockOffset(Date.parse(j.state.server_now) - Date.now());
  }, []);

  const load = useCallback(async () => {
    try {
      const r = await fetchWithTimeout(withBase("/api/admin/overview"), {}, 8_000);
      if (r.status === 401) {
        setPhase("login");
        return;
      }
      if (!r.ok) throw new Error(String(r.status));
      accept(await r.json());
      setPhase("ready");
    } catch {
      setPhase((p) => (p === "checking" ? "down" : p));
    }
  }, [accept]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  // Live: statuses + counts from Ably, the screen's presence; the 10 s poll is the safety net
  // (and refreshes the ballot/tally check)
  useEffect(() => {
    if (phase !== "ready") return;
    const feed = createStaffFeed({ role: "admin" });
    feed.onEvent((s) => {
      setOv((prev) => (prev && s.version >= prev.state.version ? { ...prev, state: s } : prev));
      setClockOffset(Date.parse(s.server_now) - Date.now());
    });
    feed.onTally((t) =>
      setOv((prev) => {
        if (!prev) return prev;
        const have = prev.tallies[t.award_id];
        if (!newer(t, have)) return prev;
        // Counts moved — the last ballot check no longer describes them until the next poll
        return { ...prev, tallies: { ...prev.tallies, [t.award_id]: { ...t, verified: have?.verified ?? true } } };
      }),
    );
    feed.onStatus(setLive);
    feed.onScreens(setScreens);
    const t = setInterval(() => void load(), POLL_MS);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      feed.close();
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [phase, load]);

  const send = useCallback(
    async (act: AdminAction, label: string): Promise<boolean> => {
      if (!ov) return false;
      const before = ov.state;
      const key = `${act.action}:${"award_id" in act ? act.award_id : ""}`;
      setBusy(key);
      setFailure(null);
      try {
        const r = await fetchWithTimeout(
          withBase("/api/admin/action"),
          { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(act) },
          10_000,
        );
        if (r.status === 401) {
          setPhase("login");
          return false;
        }
        if (r.status !== 200 && r.status !== 409) throw new Error(String(r.status));
        const j = (await r.json()) as { ok: boolean; error?: string; overview: AdminOverview; scans?: number };
        accept({ ...j.overview, scans: j.scans });
        if (!j.ok) {
          setFailure({ message: actionError(j.error), retry: null });
          return false;
        }
        const back = inverse(act, before);
        setUndo(back ? { label, act: back, undoLabel: `ย้อน: ${label}` } : null);
        return true;
      } catch {
        // State changes are idempotent server-side, so retrying the same press is always safe
        setFailure({ message: "สั่งไม่สำเร็จ ลองกดอีกครั้ง", retry: { act, label } });
        return false;
      } finally {
        setBusy(null);
      }
    },
    [ov, accept],
  );

  const logout = async () => {
    await fetch(withBase("/api/admin/logout"), { method: "POST" }).catch(() => undefined);
    setOv(null);
    setPhase("login");
  };

  if (phase === "checking") {
    return (
      <main className={a.page}>
        <p className={a.center} role="status">
          กำลังโหลด…
        </p>
      </main>
    );
  }
  if (phase === "down") {
    return (
      <main className={a.page}>
        <div className={a.alert} role="alert">
          <ExclamationTriangleIcon aria-hidden />
          <p>เชื่อมต่อระบบไม่สำเร็จ สัญญาณอาจไม่ดี</p>
          <button type="button" className={a.btn} onClick={() => void load()}>
            <ArrowPathIcon aria-hidden /> ลองใหม่
          </button>
        </div>
      </main>
    );
  }
  if (phase === "login" || !ov) {
    return <Login version={version} onDone={() => void load()} />;
  }

  const { state, tallies } = ov;
  const allRevealed = state.awards.every((x) => x.status === "revealed");
  const copyStage = async () => {
    if (!ov.stagePath) return;
    try {
      await navigator.clipboard.writeText(window.location.origin + ov.stagePath);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setFailure({ message: "คัดลอกไม่สำเร็จ กดค้างที่ลิงก์ด้านล่างเพื่อคัดลอกเอง", retry: null });
    }
  };

  return (
    <main className={a.page}>
      <header className={a.top}>
        <div className={a.topRow}>
          <h1 className={a.h1}>พิธีกร · {state.title}</h1>
          <button type="button" className={a.ghost} onClick={() => void logout()}>
            <ArrowRightStartOnRectangleIcon aria-hidden /> ออกจากระบบ
          </button>
        </div>

        <div className={a.statusRow}>
          <span
            className={screens ? `${a.pill} ${a.pillOk}` : `${a.pill} ${a.pillBad}`}
            data-screens={screens ?? ""}
            role="status"
          >
            <TvIcon aria-hidden />
            {screens === null
              ? "กำลังตรวจจอใหญ่…"
              : screens > 0
                ? `จอใหญ่เชื่อมต่ออยู่${screens > 1 ? ` (${screens} จอ)` : ""}`
                : "จอใหญ่ยังไม่เชื่อมต่อ"}
          </span>
          {state.demo && <span className={`${a.pill} ${a.pillDemo}`}>ข้อมูลตัวอย่าง</span>}
          {live !== "connected" && (
            <span className={`${a.pill} ${a.pillWarn}`} role="status">
              <SignalSlashIcon aria-hidden /> การเชื่อมต่อสดหลุด — อัปเดตทุก 10 วินาที
            </span>
          )}
        </div>

        <div className={a.controls}>
          <button
            type="button"
            role="switch"
            aria-checked={state.hide_counts}
            className={state.hide_counts ? `${a.switch} ${a.switchOn}` : a.switch}
            disabled={busy !== null}
            onClick={() => void send({ action: "hide", on: !state.hide_counts }, state.hide_counts ? "โชว์ตัวเลข" : "ซ่อนตัวเลข")}
          >
            <EyeSlashIcon aria-hidden />
            ซ่อนตัวเลขบนจอ
            <span className={a.knob} aria-hidden />
          </button>
          <button
            type="button"
            className={a.btn}
            disabled={busy !== null || (state.current_award_id === null && !state.show_hall)}
            onClick={() => void send({ action: "lobby" }, "กลับ lobby")}
          >
            <HomeIcon aria-hidden /> กลับ lobby
          </button>
          <button
            type="button"
            className={state.show_hall ? `${a.btn} ${a.btnOn}` : allRevealed ? `${a.btn} ${a.btnGold}` : a.btn}
            disabled={busy !== null}
            aria-pressed={state.show_hall}
            onClick={() => void send({ action: "hall", on: !state.show_hall }, state.show_hall ? "ปิดทำเนียบ" : "ขึ้นทำเนียบ")}
          >
            <TrophyIcon aria-hidden /> {state.show_hall ? "ปิดทำเนียบ" : "ขึ้นทำเนียบ"}
          </button>
          <button
            type="button"
            role="switch"
            aria-checked={state.qr_fallback}
            className={state.qr_fallback ? `${a.switch} ${a.switchOn}` : a.switch}
            disabled={busy !== null || (!hasFallback && !state.qr_fallback)}
            aria-describedby={hasFallback ? undefined : "fallback-note"}
            onClick={() =>
              void send({ action: "qr_fallback", on: !state.qr_fallback }, state.qr_fallback ? "QR ปกติ" : "QR สำรอง")
            }
          >
            <QrCodeIcon aria-hidden />
            QR สำรองบนจอ
            <span className={a.knob} aria-hidden />
          </button>
          <button
            type="button"
            role="switch"
            aria-checked={state.greetings_on === true}
            className={state.greetings_on ? `${a.switch} ${a.switchOn}` : a.switch}
            disabled={busy !== null || state.greetings_on === undefined || state.demo === true}
            onClick={() =>
              void send({ action: "greetings", on: !state.greetings_on }, state.greetings_on ? "ปิดข้อความขึ้นจอ" : "เปิดข้อความขึ้นจอ")
            }
          >
            <ChatBubbleLeftRightIcon aria-hidden />
            ข้อความทักทายขึ้นจอ{state.demo ? " (ปิดถาวรในระบบตัวอย่าง)" : ""}
            <span className={a.knob} aria-hidden />
          </button>
        </div>
        <div className={a.statusRow}>
          <span className={a.pill} role="status" data-scans={ov.scans ?? ""}>
            <UsersIcon aria-hidden />
            {ov.scans === null ? "ตัวนับคนสแกนยังไม่พร้อม" : `สแกนแล้ว ${ov.scans.toLocaleString("th-TH")} คน`}
          </span>
          <HoldButton
            tone="danger"
            hint="กดค้าง 1.5 วิ (ใช้หลังซ้อม)"
            disabled={busy !== null}
            onConfirm={() => void send({ action: "reset_scans" }, "ล้างตัวเลขคนสแกน")}
          >
            ล้างตัวเลขคนสแกน
          </HoldButton>
        </div>
        {!hasFallback && (
          <p id="fallback-note" className={a.note}>
            ยังไม่ได้ตั้งลิงก์สำรอง — ปุ่ม QR สำรองจะใช้ได้เมื่อตั้งค่าแล้ว
          </p>
        )}

        {ov.stagePath && (
          <div className={a.stageLink}>
            <span>ลิงก์จอใหญ่</span>
            <code>{ov.stagePath}</code>
            <button type="button" className={a.ghost} onClick={() => void copyStage()}>
              {copied ? <CheckIcon aria-hidden /> : <ClipboardDocumentIcon aria-hidden />}
              {copied ? "คัดลอกแล้ว" : "คัดลอก"}
            </button>
          </div>
        )}

        {failure && (
          <div className={a.alert} role="alert">
            <ExclamationTriangleIcon aria-hidden />
            <p>{failure.message}</p>
            {failure.retry && (
              <button
                type="button"
                className={a.btn}
                disabled={busy !== null}
                onClick={() => failure.retry && void send(failure.retry.act, failure.retry.label)}
              >
                <ArrowPathIcon aria-hidden /> ลองใหม่
              </button>
            )}
          </div>
        )}
        {undo && !failure && (
          <div className={a.undo} role="status">
            <CheckIcon aria-hidden />
            <p>ทำแล้ว: {undo.label}</p>
            <button
              type="button"
              className={a.btn}
              disabled={busy !== null}
              // The bar stays (now offering the redo) so the cards below never jump under a finger
              onClick={() => void send(undo.act, undo.undoLabel)}
            >
              <ArrowUturnLeftIcon aria-hidden /> ย้อน
            </button>
          </div>
        )}
      </header>

      <ol className={a.list}>
        {state.awards.map((x) => (
          <li key={x.id}>
            <AwardCard
              award={x}
              tally={tallies[x.id]?.round === x.round ? tallies[x.id] : undefined}
              current={state.current_award_id === x.id && !state.show_hall}
              anotherOpen={state.awards.some((o) => o.status === "open" && o.id !== x.id)}
              clockOffset={clockOffset}
              busy={busy}
              send={send}
              canRename={state.demo !== true}
            />
          </li>
        ))}
      </ol>

      <footer className={a.footer}>{version}</footer>
    </main>
  );
}
