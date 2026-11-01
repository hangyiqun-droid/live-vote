"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowPathIcon,
  ArrowUturnLeftIcon,
  CheckBadgeIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  PencilSquareIcon,
  PlayIcon,
  PlusIcon,
  StopIcon,
  TrashIcon,
  TrophyIcon,
  TvIcon,
} from "@heroicons/react/24/solid";
import { nomineeById } from "@/data/nominees";
import { Avatar } from "@/components/avatar";
import { EXTEND_SECONDS, TIMER_CHOICES, type AdminAction } from "@/lib/admin-actions";
import { withBase } from "@/lib/base-path";
import type { AdminTally, AwardState, AwardStatus } from "@/lib/types";
import { rankRows } from "@/app/stage/race";
import { HoldButton } from "./hold-button";
import a from "./admin.module.css";

const fmt = (n: number) => n.toLocaleString("th-TH");

const STATUS: Record<AwardStatus, { label: string; cls: string }> = {
  pending: { label: "ยังไม่เปิด", cls: a.badgePending },
  open: { label: "เปิดโหวตอยู่", cls: a.badgeOpen },
  closed: { label: "ปิดโหวตแล้ว", cls: a.badgeClosed },
  revealed: { label: "ประกาศผลแล้ว", cls: a.badgeRevealed },
};

type Props = {
  award: AwardState;
  tally: AdminTally | undefined;
  current: boolean;
  anotherOpen: boolean;
  clockOffset: number;
  busy: string | null;
  send: (act: AdminAction, label: string) => Promise<boolean>;
};

export function AwardCard({ award, tally, current, anotherOpen, clockOffset, busy, send }: Props) {
  const [timer, setTimer] = useState<number | null>(null);
  const [panel, setPanel] = useState<"none" | "reset" | "rename">("none");
  const total = tally?.total ?? 0;
  const rows = rankRows(tally?.counts ?? [], tally?.order).filter((r) => r.votes > 0).slice(0, 5);
  const mine = busy?.endsWith(`:${award.id}`) ?? false;
  const locked = busy !== null;
  const name = `"${award.title}"`;

  return (
    <section className={current ? `${a.card} ${a.cardCurrent}` : a.card} data-award={award.id} aria-label={award.title}>
      <div className={a.cardHead}>
        <div>
          <h2 className={a.cardTitle}>{award.title}</h2>
          {award.subtitle && <p className={a.cardSub}>{award.subtitle}</p>}
        </div>
        <button
          type="button"
          className={a.iconBtn}
          aria-label={`แก้ชื่อรางวัล ${award.title}`}
          onClick={() => setPanel(panel === "rename" ? "none" : "rename")}
        >
          <PencilSquareIcon aria-hidden />
        </button>
      </div>

      <div className={a.meta}>
        <span className={`${a.badge} ${STATUS[award.status].cls}`} data-status={award.status}>
          {STATUS[award.status].label}
        </span>
        {current && (
          <span className={`${a.badge} ${a.badgeScreen}`}>
            <TvIcon aria-hidden /> บนจอ
          </span>
        )}
        <span className={a.total}>
          เสียงรวม <strong data-total>{fmt(total)}</strong>
        </span>
        {award.status === "open" && award.auto_close_at && (
          <TimeLeft endsAt={award.auto_close_at} clockOffset={clockOffset} />
        )}
        {mine && <ArrowPathIcon className={a.spin} aria-label="กำลังสั่ง…" />}
      </div>

      {panel === "rename" && (
        <RenameForm award={award} disabled={locked} send={send} onClose={() => setPanel("none")} />
      )}

      {rows.length > 0 ? (
        <ol className={a.top5} aria-label="อันดับสด">
          {rows.map((r) => {
            const n = nomineeById.get(r.id)!;
            return (
              <li key={r.id}>
                <span className={a.rank}>{r.rank}</span>
                <Avatar nominee={n} size={32} />
                <span className={a.nick}>{n.nickname}</span>
                <span className={`${a.chip} ${a[`g${n.group}`]}`}>{n.group}</span>
                <span className={a.votes}>{fmt(r.votes)}</span>
              </li>
            );
          })}
        </ol>
      ) : (
        award.status !== "pending" && <p className={a.empty}>ยังไม่มีเสียงโหวต</p>
      )}

      {(award.status === "closed" || award.status === "revealed") && tally && (
        <p className={tally.verified ? a.verified : a.unverified}>
          {tally.verified ? <CheckBadgeIcon aria-hidden /> : <ExclamationTriangleIcon aria-hidden />}
          {tally.verified ? "ยอดตรง (เสียงทุกใบอยู่บนกระดานนับ)" : "ยอดยังไม่ตรง รอสักครู่แล้วดูอีกครั้งก่อนประกาศ"}
        </p>
      )}

      <div className={a.actions}>
        {award.status === "pending" && (
          <>
            {!current && (
              <button type="button" className={a.btn} disabled={locked} onClick={() => void send({ action: "show", award_id: award.id }, `ขึ้นจอ ${name}`)}>
                <TvIcon aria-hidden /> ขึ้นจอ
              </button>
            )}
            <div className={a.timerPick} role="radiogroup" aria-label="จับเวลาปิดโหวต">
              <span className={a.timerLabel}>
                <ClockIcon aria-hidden /> จับเวลา
              </span>
              {TIMER_CHOICES.map((t) => (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={timer === t}
                  className={timer === t ? `${a.seg} ${a.segOn}` : a.seg}
                  onClick={() => setTimer(t)}
                >
                  {t === 0 ? "ไม่จับ" : `${t} วิ`}
                </button>
              ))}
            </div>
            <button
              type="button"
              className={`${a.btn} ${a.btnPrimary}`}
              disabled={locked || timer === null || anotherOpen}
              aria-describedby={`open-hint-${award.id}`}
              onClick={() => {
                if (timer === null) return;
                void send({ action: "open", award_id: award.id, seconds: timer }, `เปิดโหวต ${name}`).then((ok) => ok && setTimer(null));
              }}
            >
              <PlayIcon aria-hidden /> เปิดโหวต
            </button>
            <p id={`open-hint-${award.id}`} className={a.note}>
              {anotherOpen
                ? "มีรางวัลอื่นเปิดโหวตอยู่ ปิดรางวัลนั้นก่อน"
                : timer === null
                  ? "เลือกจับเวลาก่อน แล้วกดเปิดโหวต"
                  : timer === 0
                    ? "ไม่จับเวลา — ปิดโหวตเองด้วยปุ่มปิดโหวต"
                    : `ปิดเองอัตโนมัติเมื่อครบ ${timer} วินาที`}
            </p>
          </>
        )}

        {award.status === "open" && (
          <>
            <HoldButton tone="danger" hint="กดค้าง 1.5 วิ" disabled={locked} onConfirm={() => void send({ action: "close", award_id: award.id }, `ปิดโหวต ${name}`)}>
              <StopIcon aria-hidden /> ปิดโหวต
            </HoldButton>
            {award.auto_close_at && (
              <button type="button" className={a.btn} disabled={locked} onClick={() => void send({ action: "extend", award_id: award.id }, `ต่อเวลา +${EXTEND_SECONDS} วิ`)}>
                <PlusIcon aria-hidden /> ต่อเวลา {EXTEND_SECONDS} วิ
              </button>
            )}
          </>
        )}

        {award.status === "closed" && (
          <>
            {total === 0 && (
              <p className={a.warn} role="note">
                <ExclamationTriangleIcon aria-hidden /> ยังไม่มีผู้ได้รับเสียง — ถ้าประกาศตอนนี้ จอจะขึ้นว่า &quot;ยังไม่มีผู้ได้รับเสียง&quot;
              </p>
            )}
            <HoldButton tone="gold" hint="กดค้าง 1.5 วิ" disabled={locked} onConfirm={() => void send({ action: "reveal", award_id: award.id }, `ประกาศผล ${name}`)}>
              <TrophyIcon aria-hidden /> ประกาศผล
            </HoldButton>
            <button type="button" className={a.btn} disabled={locked || anotherOpen} onClick={() => void send({ action: "reopen", award_id: award.id }, `เปิดโหวตต่อ ${name}`)}>
              <PlayIcon aria-hidden /> เปิดต่อ
            </button>
            {!current && (
              <button type="button" className={a.btn} disabled={locked} onClick={() => void send({ action: "show", award_id: award.id }, `ขึ้นจอ ${name}`)}>
                <TvIcon aria-hidden /> ขึ้นจอ
              </button>
            )}
            <button
              type="button"
              className={`${a.btn} ${a.btnQuiet}`}
              disabled={locked}
              aria-expanded={panel === "reset"}
              onClick={() => setPanel(panel === "reset" ? "none" : "reset")}
            >
              <TrashIcon aria-hidden /> รีเซ็ตคะแนน
            </button>
          </>
        )}

        {award.status === "revealed" && (
          <>
            <button type="button" className={a.btn} disabled={locked} onClick={() => void send({ action: "unreveal", award_id: award.id }, `ย้อนประกาศ ${name}`)}>
              <ArrowUturnLeftIcon aria-hidden /> ย้อนประกาศ
            </button>
            {!current && (
              <button type="button" className={a.btn} disabled={locked} onClick={() => void send({ action: "show", award_id: award.id }, `ขึ้นจอ ${name}`)}>
                <TvIcon aria-hidden /> ขึ้นจอ
              </button>
            )}
          </>
        )}
      </div>

      {panel === "reset" && award.status === "closed" && (
        <ResetForm award={award} disabled={locked} send={send} onClose={() => setPanel("none")} />
      )}
    </section>
  );
}

function TimeLeft({ endsAt, clockOffset }: { endsAt: string; clockOffset: number }) {
  const end = Date.parse(endsAt);
  const [left, setLeft] = useState<number | null>(null);
  const asked = useRef(false);
  useEffect(() => {
    const tick = () => setLeft(Math.max(0, Math.ceil((end - Date.now() - clockOffset) / 1000)));
    queueMicrotask(tick);
    const t = setInterval(tick, 250);
    return () => clearInterval(t);
  }, [end, clockOffset]);
  useEffect(() => {
    // The MC page can close an expired award too — the server clock decides
    if (left === 0 && !asked.current) {
      asked.current = true;
      void fetch(withBase("/api/admin/expire"), { method: "POST", cache: "no-store" }).catch(() => undefined);
    }
  }, [left]);
  if (left === null) return null;
  return (
    <span className={left <= 10 ? `${a.time} ${a.timeLow}` : a.time} role="timer">
      <ClockIcon aria-hidden />
      {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
    </span>
  );
}

function ResetForm({ award, disabled, send, onClose }: { award: AwardState; disabled: boolean; send: Props["send"]; onClose: () => void }) {
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const id = `reset-${award.id}`;
  const matches = typed.trim() === award.title.trim();
  return (
    <form
      className={a.panel}
      onSubmit={(e) => {
        e.preventDefault();
        if (!matches) {
          setError("พิมพ์ชื่อรางวัลให้ตรงทุกตัวอักษรก่อน");
          return;
        }
        void send({ action: "reset", award_id: award.id, confirm: typed }, `รีเซ็ตคะแนน "${award.title}"`).then((ok) => ok && onClose());
      }}
    >
      <p className={a.warn}>
        <ExclamationTriangleIcon aria-hidden /> ลบเสียงทั้งหมดของรางวัลนี้ และกลับไปเป็น &quot;ยังไม่เปิด&quot; — ย้อนไม่ได้
      </p>
      <label htmlFor={id} className={a.label}>
        พิมพ์ชื่อรางวัล <strong>{award.title}</strong> เพื่อยืนยัน
      </label>
      <input
        id={id}
        className={a.input}
        value={typed}
        autoComplete="off"
        onChange={(e) => {
          setTyped(e.target.value);
          setError(null);
        }}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      {error && (
        <p id={`${id}-error`} className={a.fieldError} role="alert">
          {error}
        </p>
      )}
      <div className={a.actions}>
        <button type="submit" className={`${a.btn} ${a.btnDanger}`} disabled={disabled || !matches}>
          <TrashIcon aria-hidden /> ลบคะแนนรางวัลนี้
        </button>
        <button type="button" className={a.btn} onClick={onClose}>
          ยกเลิก
        </button>
      </div>
    </form>
  );
}

function RenameForm({ award, disabled, send, onClose }: { award: AwardState; disabled: boolean; send: Props["send"]; onClose: () => void }) {
  const [title, setTitle] = useState(award.title);
  const [subtitle, setSubtitle] = useState(award.subtitle ?? "");
  const [error, setError] = useState<string | null>(null);
  const id = `rename-${award.id}`;
  return (
    <form
      className={a.panel}
      onSubmit={(e) => {
        e.preventDefault();
        const t = title.trim();
        if (!t || t.length > 80) {
          setError("ชื่อรางวัลต้องมี 1–80 ตัวอักษร");
          return;
        }
        if (subtitle.trim().length > 120) {
          setError("คำอธิบายยาวได้ไม่เกิน 120 ตัวอักษร");
          return;
        }
        void send({ action: "rename", award_id: award.id, title: t, subtitle: subtitle.trim() }, `แก้ชื่อเป็น "${t}"`).then((ok) => ok && onClose());
      }}
    >
      <label htmlFor={`${id}-title`} className={a.label}>
        ชื่อรางวัล
      </label>
      <input
        id={`${id}-title`}
        className={a.input}
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
          setError(null);
        }}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      <label htmlFor={`${id}-sub`} className={a.label}>
        คำอธิบาย (ไม่ใส่ก็ได้)
      </label>
      <input id={`${id}-sub`} className={a.input} value={subtitle} onChange={(e) => setSubtitle(e.target.value)} />
      {error && (
        <p id={`${id}-error`} className={a.fieldError} role="alert">
          {error}
        </p>
      )}
      <div className={a.actions}>
        <button type="submit" className={`${a.btn} ${a.btnPrimary}`} disabled={disabled}>
          บันทึกชื่อ
        </button>
        <button type="button" className={a.btn} onClick={onClose}>
          ยกเลิก
        </button>
      </div>
    </form>
  );
}
