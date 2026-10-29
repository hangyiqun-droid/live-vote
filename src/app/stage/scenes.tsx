"use client";

import { GROUPS, nominees } from "@/data/nominees";
import { photoSrc } from "@/components/photo";
import type { AwardState } from "@/lib/types";
import { groupVars } from "./palette";
import { QrCode, type QrProps } from "./qr-panel";
import { WarmUp } from "./race-view";
import s from "./stage.module.css";

// current_award_id = null: everyone's face by group, floating slowly (SPEC 4.1 "lobby")
export function Lobby({ title }: { title: string }) {
  return (
    <>
      <WarmUp />
      <div className={s.lobbyTitle}>
        <p>ร่วมโหวตรางวัลสด</p>
        <h1>{title}</h1>
      </div>
      <div className={s.lobbyRows}>
        {GROUPS.map((g) => (
          <div key={g} className={s.lobbyRow} style={groupVars(g)}>
            <span className={s.lobbyGroup} style={{ color: "var(--g2)" }}>
              {g}
            </span>
            {nominees
              .filter((n) => n.group === g)
              .map((n) => (
                <div key={n.id} className={s.lobbyFace} style={{ animationDelay: `${-((n.id * 0.73) % 7)}s` }}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- pre-sized WebP, no optimizer (SPEC 4.0) */}
                  <img src={photoSrc(n.id, 120)} width={96} height={128} alt={`${n.nickname} ${n.group}`} />
                </div>
              ))}
          </div>
        ))}
      </div>
      <p className={s.lobbyWait}>รอพิธีกรเปิดรางวัลแรก</p>
    </>
  );
}

// Award chosen but not open yet: big title card + QR so people can scan early (SPEC 4.1 "pending")
export function Pending({ award, qr }: { award: AwardState; qr: QrProps }) {
  return (
    <>
      <WarmUp />
      <div className={s.pending}>
        <div className={s.pendingCard}>
          <p>{qr.eventTitle}</p>
          <h1>{award.title}</h1>
          {award.subtitle && <h2>{award.subtitle}</h2>}
          <h2>สแกนเตรียมไว้ได้เลย</h2>
        </div>
        <div style={{ textAlign: "center" }}>
          <QrCode qr={qr.qr} px={440} />
          <p className={s.qrHint}>สแกนเพื่อโหวต</p>
          <p className={s.qrUrl}>{qr.urlLabel}</p>
        </div>
      </div>
    </>
  );
}
