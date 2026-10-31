"use client";

import { GROUPS, nominees } from "@/data/nominees";
import { photoSrc } from "@/components/photo";
import type { AwardState } from "@/lib/types";
import { groupVars } from "./palette";
import { WarmUp } from "./race-view";
import { fitTitle } from "./title-fit";
import s from "./stage.module.css";
import { GreetingBubbles } from "./greeting-bubbles";
import { LobbyCount } from "./lobby-count";
import { COUNT_H, COUNT_TOP, QR_PX, QR_TOP, ROWS_TOP, ROW_GAP, TITLE_TOP, URL_ROOM } from "./lobby-layout";
import { QrCode, type LinkProps } from "./vote-panel";

// current_award_id = null: everyone's face by group, floating slowly, QR on the right — the only
// QR on the stage, so first-time voters can get in (SPEC 4.1 "lobby"). fix9: the right column also
// counts the phones that scanned, and a zone under the faces shows greetings from the room. Every
// box is placed from lobby-layout.ts, so bubbles never cover a face or the QR.
export function Lobby({
  title,
  link,
  scans,
  greetingsOn,
  showCount,
}: {
  title: string;
  link: LinkProps;
  scans: number | null;
  greetingsOn: boolean;
  showCount: boolean;
}) {
  return (
    <>
      <WarmUp />
      <div className={s.lobbyTitle} style={{ top: TITLE_TOP }}>
        <p>ร่วมโหวตรางวัลสด</p>
        <h1 style={{ fontSize: fitTitle(title, 64, 1180) }}>{title}</h1>
      </div>
      <div className={s.lobbyRows} style={{ top: ROWS_TOP, gap: ROW_GAP }}>
        {GROUPS.map((g) => (
          <div key={g} className={s.lobbyRow} style={groupVars(g)}>
            <span className={s.lobbyGroup} style={{ color: "var(--g2)" }}>
              {g}
            </span>
            {nominees
              .filter((n) => n.group === g)
              .map((n) => (
                <div key={n.id} className={s.lobbyFace} data-lobby-face style={{ animationDelay: `${-((n.id * 0.73) % 7)}s` }}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- pre-sized WebP, no optimizer (SPEC 4.0) */}
                  <img src={photoSrc(n.id, 120)} width={96} height={128} alt={`${n.nickname} ${n.group}`} />
                </div>
              ))}
          </div>
        ))}
      </div>
      {showCount && (
        <div className={s.lobbyCount} style={{ top: COUNT_TOP, height: COUNT_H }}>
          <LobbyCount value={scans} />
        </div>
      )}
      <aside className={s.lobbyQr} style={{ top: QR_TOP }}>
        <QrCode qr={link.qr} px={QR_PX} />
        <p className={s.qrHint}>สแกนเพื่อโหวต</p>
        {/* One line, always: a long backup address shrinks instead of wrapping or touching the edge */}
        <p className={s.qrUrl} data-qr-url style={{ fontSize: fitTitle(link.urlLabel, 40, URL_ROOM) }}>
          {link.urlLabel}
        </p>
        <p className={s.lobbyWait}>รอพิธีกรเปิดรางวัลแรก</p>
      </aside>
      {greetingsOn && <GreetingBubbles />}
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
