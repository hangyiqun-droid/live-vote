"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ClockIcon } from "@heroicons/react/24/solid";
import type { AwardState } from "@/lib/types";
import { Count } from "./count";
import { fitTitle } from "./title-fit";
import s from "./stage.module.css";

export type LinkProps = {
  qr: { size: number; d: string }; // drawn on the lobby only
  urlLabel: string; // "vote.example.com"
  eventTitle: string;
};

export function QrCode({ qr, px, small }: { qr: LinkProps["qr"]; px: number; small?: boolean }) {
  return (
    <div className={small ? `${s.qrCard} ${s.qrCardSmall}` : s.qrCard}>
      <svg width={px} height={px} viewBox={`0 0 ${qr.size} ${qr.size}`} shapeRendering="crispEdges" role="img" aria-label="QR โหวต">
        <path d={qr.d} fill="#0b1026" />
      </svg>
    </div>
  );
}

// Right ~30%: running total, countdown, and a small rescue QR at the bottom for phones that dropped
// out. Phones follow the MC on their own and the big QR lives on the lobby only, so this one says
// "for lost phones" — not "everyone scan" (SPEC 4.1, fix9 follow-up). Same QR as the lobby, so the
// MC's backup-link switch swaps it too.
export const RESCUE_QR_PX = 208;
export const RESCUE_URL_ROOM = 500; // the address stays on one line inside this width

export function VotePanel({
  qr,
  urlLabel,
  total,
  award,
  clockOffset,
}: Pick<LinkProps, "qr" | "urlLabel"> & { total: number; award: AwardState; clockOffset: number }) {
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
        <div className={s.voteHint} data-rescue-qr>
          <QrCode qr={qr} px={RESCUE_QR_PX} small />
          <p>มือถือหลุด สแกนเข้าใหม่ได้</p>
          <p className={s.voteUrl} data-rescue-url style={{ fontSize: fitTitle(urlLabel, 26, RESCUE_URL_ROOM) }}>
            {urlLabel}
          </p>
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
