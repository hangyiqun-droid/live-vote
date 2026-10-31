"use client";

import { GROUPS, nominees } from "@/data/nominees";
import { photoSrc } from "@/components/photo";
import type { AwardState } from "@/lib/types";
import { groupVars } from "./palette";
import { WarmUp } from "./race-view";
import { fitTitle } from "./title-fit";
import s from "./stage.module.css";
import { QrCode, type LinkProps } from "./vote-panel";

// current_award_id = null: everyone's face by group, floating slowly, QR on the right — the only
// QR on the stage, so first-time voters can get in (SPEC 4.1 "lobby")
export function Lobby({ title, link }: { title: string; link: LinkProps }) {
  return (
    <>
      <WarmUp />
      <div className={s.lobbyTitle}>
        <p>ร่วมโหวตรางวัลสด</p>
        <h1 style={{ fontSize: fitTitle(title, 76, 1240) }}>{title}</h1>
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
      <aside className={s.lobbyQr}>
        <QrCode qr={link.qr} px={400} />
        <p className={s.qrHint}>สแกนเพื่อโหวต</p>
        <p className={s.qrUrl}>{link.urlLabel}</p>
      </aside>
      <p className={s.lobbyWait}>รอพิธีกรเปิดรางวัลแรก</p>
    </>
  );
}

// Award chosen but not open yet: the award name fills the screen, no QR — phones switch by themselves,
// so a code here only made people rescan (SPEC 4.1 "pending")
export function Pending({ award, eventTitle }: { award: AwardState; eventTitle: string }) {
  return (
    <>
      <WarmUp />
      <div className={s.pending}>
        <div className={s.pendingCard}>
          <p className={s.pendingEvent}>{eventTitle}</p>
          <h1 style={{ fontSize: fitTitle(award.title, 168, 1560) }}>{award.title}</h1>
          {award.subtitle && <h2>{award.subtitle}</h2>}
          <p className={s.pendingWait}>รอพิธีกรเปิดโหวต</p>
        </div>
      </div>
    </>
  );
}
