"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ClockIcon, DevicePhoneMobileIcon } from "@heroicons/react/24/solid";
import type { AwardState } from "@/lib/types";
import { Count } from "./count";
import s from "./stage.module.css";

export type LinkProps = {
  qr: { size: number; d: string }; // drawn on the lobby only
  urlLabel: string; // "vote.example.com"
  eventTitle: string;
};

export function QrCode({ qr, px }: { qr: LinkProps["qr"]; px: number }) {
  return (
    <div className={s.qrCard}>
      <svg width={px} height={px} viewBox={`0 0 ${qr.size} ${qr.size}`} shapeRendering="crispEdges" role="img" aria-label="QR โหวต">
        <path d={qr.d} fill="#0b1026" />
      </svg>
    </div>
  );
}

// Right ~30%: running total, countdown, and a small "vote on your phone" line for late arrivals.
// No QR here on purpose: phones follow the MC on their own, a QR on screen made people rescan (SPEC 4.1)
export function VotePanel({
  urlLabel,
  total,
  award,
  clockOffset,
}: Pick<LinkProps, "urlLabel"> & { total: number; award: AwardState; clockOffset: number }) {
  const totalRef = useRef<HTMLDivElement>(null);
  const last = useRef(total);

  // Total still bumps while counts are hidden — the room should feel votes coming in
  useLayoutEffect(() => {
    if (total > last.current) {
      totalRef.current?.animate([{ transform: "scale(1)" }, { transform: "scale(1.12)" }, { transform: "scale(1)" }], {
        duration: 320,
        easing: "ease-out",
      });
    }
    last.current = total;
  }, [total]);

  return (
    <aside className={s.votePanel}>
      <p className={s.totalLabel}>เสียงรวม</p>
      <div ref={totalRef} className={s.total} data-stage-total={total}>
        <Count value={total} />
      </div>
      {award.status === "open" && award.auto_close_at && (
        <Countdown endsAt={Date.parse(award.auto_close_at)} clockOffset={clockOffset} />
      )}
      {award.status === "open" && (
        <div className={s.voteHint}>
          <DevicePhoneMobileIcon aria-hidden />
          <p>โหวตบนมือถือได้เลย</p>
          <p className={s.voteUrl}>{urlLabel}</p>
        </div>
      )}
    </aside>
  );
}

function Countdown({ endsAt, clockOffset }: { endsAt: number; clockOffset: number }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now() + clockOffset);
    queueMicrotask(tick);
    const t = setInterval(tick, 250);
    return () => clearInterval(t);
  }, [clockOffset]);
  if (now === null) return null;
  const left = Math.max(0, Math.ceil((endsAt - now) / 1000));
  const text = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
  // Last 10 seconds: one big number that beats every second (SPEC 5.2), in place of the clock
  if (left > 0 && left <= 10) {
    return (
      <p key={left} className={s.countdownBig} role="timer" aria-label={`เหลือ ${left} วินาที`}>
        {left}
      </p>
    );
  }
  return (
    <p className={left <= 10 ? `${s.countdown} ${s.countdownLow}` : s.countdown} role="timer">
      <ClockIcon aria-hidden />
      {text}
    </p>
  );
}
