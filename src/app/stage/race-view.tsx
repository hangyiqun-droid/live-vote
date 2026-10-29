"use client";

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowTrendingUpIcon, FireIcon } from "@heroicons/react/24/solid";
import { nomineeById, type Nominee } from "@/data/nominees";
import { photoSrc } from "@/components/photo";
import type { AwardState, TallySnapshot } from "@/lib/types";
import { Count } from "./count";
import {
  BAR_W,
  BAR_X,
  LANE_H,
  PAD,
  PHOTO_H,
  PHOTO_W,
  QR_CENTER,
  STRIP_PHOTO_W,
  STRIP_SCALE,
  STRIP_STEP,
  STRIP_TOP,
  laneY,
  photoPlace,
} from "./geometry";
import { groupVars } from "./palette";
import { QrPanel, type QrProps } from "./qr-panel";
import { LANES, chasingIds, diffRows, idOrderRows, rankRows, type Row } from "./race";
import s from "./stage.module.css";

const HIDDEN_BAR = 0.62; // every bar the same length while counts are hidden (SPEC 4.1)
const MAX_DOTS = 8; // light dots per commit — enough to feel busy, cheap at 100 votes / 10 s

type Parts = { inner?: HTMLDivElement | null; flash?: HTMLDivElement | null; badge?: HTMLDivElement | null; face?: HTMLDivElement | null };

export function RaceView({
  award,
  tally,
  hide,
  qr,
  clockOffset,
}: {
  award: AwardState;
  tally: TallySnapshot | undefined;
  hide: boolean;
  qr: QrProps;
  clockOffset: number;
}) {
  const live = useMemo(() => rankRows(tally?.counts ?? []), [tally]);

  // Hiding freezes the lane order where it was (SPEC 4.1). A screen that loads while already
  // hidden has no "where it was", so it uses nominee order instead of leaking the standings.
  const [freeze, setFreeze] = useState(() => ({ hide, rows: hide ? idOrderRows() : null }));
  if (freeze.hide !== hide) setFreeze({ hide, rows: hide ? live : null });
  const rows = (hide && freeze.rows) || live;

  // DOM order never changes — only transforms do. Re-ordering nodes would make the browser
  // restart their CSS animations mid-move (seen in M2 testing as lanes jumping sideways).
  const stable = [...rows].sort((a, b) => a.id - b.id);

  const total = tally?.total ?? 0;
  const max = Math.max(1, live[0]?.votes ?? 0);
  // The flame is about the race still running — not shown while hidden or after closing
  const chasing = hide || award.status !== "open" ? new Set<number>() : chasingIds(rows);
  const empty = total === 0;

  const parts = useRef(new Map<number, Parts>());
  const fx = useRef<HTMLDivElement>(null);
  const prev = useRef<Row[] | null>(null);

  // Effects that fire once per change, played with the Web Animations API on transform/opacity
  useLayoutEffect(() => {
    const before = prev.current;
    prev.current = live;
    if (!before || hide) return; // hidden: no per-person hint of who got the vote
    const change = diffRows(before, live);
    const slotOf = new Map(live.map((r) => [r.id, r]));
    const top = Math.max(1, live[0].votes);

    let dots = 0;
    for (const id of change.gained.keys()) {
      const r = slotOf.get(id)!;
      popFace(parts.current.get(id)?.face);
      if (dots++ < MAX_DOTS && fx.current) {
        const to =
          r.slot < LANES
            ? { x: BAR_X + BAR_W * (r.votes / top), y: laneY(r.slot) + LANE_H / 2 }
            : { x: photoPlace(r.slot).x + STRIP_PHOTO_W / 2, y: STRIP_TOP + 36 };
        flyDot(fx.current, to);
      }
    }
    for (const id of change.overtook) {
      if (slotOf.get(id)!.slot >= LANES) continue;
      const p = parts.current.get(id);
      flashLane(p?.flash);
      showBadge(p?.badge);
    }
    if (change.newLeader !== null) zoomLane(parts.current.get(change.newLeader)?.inner);
  }, [live, hide]);

  // Stable so the memoised lanes only re-render when their own numbers change
  const [register] = useState(() => (id: number, key: keyof Parts) => (el: HTMLDivElement | null) => {
    const p = parts.current.get(id) ?? {};
    p[key] = el;
    parts.current.set(id, p);
  });

  const closed = award.status === "closed" || award.status === "revealed";

  return (
    <>
      <header className={s.raceHeader}>
        <div>
          <p>{qr.eventTitle}</p>
          <h1>{award.title}</h1>
        </div>
        <span className={award.status === "open" ? s.status : `${s.status} ${s.statusOff}`}>
          {award.status === "open" ? "เปิดโหวตอยู่" : award.status === "closed" ? "ปิดโหวตแล้ว" : "ประกาศผลแล้ว"}
        </span>
      </header>

      {stable.map((r) => (
        <Lane
          key={r.id}
          n={nomineeById.get(r.id)!}
          row={r}
          frac={hide ? HIDDEN_BAR : r.votes / max}
          hide={hide}
          chasing={chasing.has(r.id)}
          leader={!hide && r.rank === 1 && r.votes > 0}
          dim={empty}
          register={register}
        />
      ))}
      <div className={s.stripLine} />
      {stable.map((r) => (
        <Photo key={r.id} n={nomineeById.get(r.id)!} slot={r.slot} register={register} />
      ))}
      {stable.map((r) => (
        <StripItem key={r.id} n={nomineeById.get(r.id)!} slot={r.slot} votes={r.votes} hide={hide} />
      ))}

      <div ref={fx} className={s.fx} />

      {empty && award.status === "open" && <p className={s.emptyCall}>เป็นคนแรกที่โหวต!</p>}
      {closed && (
        <>
          <div className={s.veil} />
          <p className={award.status === "closed" ? s.stamp : `${s.stamp} ${s.stampReveal}`}>
            {award.status === "closed" ? "ปิดโหวตแล้ว" : "ประกาศผลแล้ว"}
          </p>
        </>
      )}

      <QrPanel {...qr} total={total} award={award} clockOffset={clockOffset} />
    </>
  );
}

function popFace(el: HTMLElement | null | undefined) {
  el?.animate([{ transform: "scale(1)" }, { transform: "scale(1.18)" }, { transform: "scale(1)" }], {
    duration: 380,
    easing: "ease-out",
  });
}

function flashLane(el: HTMLElement | null | undefined) {
  el?.animate([{ opacity: 0 }, { opacity: 1 }, { opacity: 0 }], { duration: 900, easing: "ease-out" });
}

function showBadge(el: HTMLElement | null | undefined) {
  el?.animate(
    [
      { opacity: 0, transform: "scale(0.6)" },
      { opacity: 1, transform: "scale(1.12)", offset: 0.12 },
      { opacity: 1, transform: "scale(1)", offset: 0.22 },
      { opacity: 1, transform: "scale(1)", offset: 0.85 },
      { opacity: 0, transform: "scale(1)" },
    ],
    { duration: 1500, easing: "ease-out" },
  );
}

function zoomLane(el: HTMLElement | null | undefined) {
  el?.animate([{ transform: "scale(1)" }, { transform: "scale(1.035)" }, { transform: "scale(1)" }], {
    duration: 700,
    easing: "cubic-bezier(0.3, 1.4, 0.5, 1)",
  });
}

function flyDot(layer: HTMLDivElement, to: { x: number; y: number }) {
  const dot = document.createElement("div");
  dot.className = s.dot;
  layer.appendChild(dot);
  const jitter = (Math.random() - 0.5) * 160;
  const a = dot.animate(
    [
      { transform: `translate(${QR_CENTER.x}px, ${QR_CENTER.y + jitter}px) scale(1.4)`, opacity: 0 },
      { opacity: 1, offset: 0.15 },
      { transform: `translate(${to.x}px, ${to.y}px) scale(0.8)`, opacity: 1, offset: 0.92 },
      { transform: `translate(${to.x}px, ${to.y}px) scale(2.2)`, opacity: 0 },
    ],
    { duration: 560, easing: "cubic-bezier(0.5, 0, 0.75, 0.6)" },
  );
  a.onfinish = () => dot.remove();
}

type LaneProps = {
  n: Nominee;
  row: Row;
  frac: number;
  hide: boolean;
  chasing: boolean;
  leader: boolean;
  dim: boolean;
  register: (id: number, key: keyof Parts) => (el: HTMLDivElement | null) => void;
};

// One full lane (ranks 1–8). Kept mounted for all 29 so a climber from the strip slides and fades
// in instead of popping (SPEC 5.1 "บินขึ้น")
const Lane = memo(function Lane({ n, row, frac, hide, chasing, leader, dim, register }: LaneProps) {
  const inLane = row.slot < LANES;
  const cls = [s.lane, chasing && s.chasing, leader && s.leader].filter(Boolean).join(" ");
  return (
    <div
      className={cls}
      data-nominee={n.id}
      data-slot={row.slot}
      aria-hidden={!inLane}
      style={{
        ...groupVars(n.group),
        transform: `translate(${PAD}px, ${inLane ? laneY(row.slot) : STRIP_TOP}px)`,
        opacity: inLane ? 1 : 0,
      }}
    >
      <div
        ref={register(n.id, "inner")}
        className={dim ? `${s.laneIn} ${s.laneEmpty}` : s.laneIn}
        style={{ animationDelay: `${Math.min(row.slot, LANES) * 40}ms` }}
      >
        <div className={s.laneBg} />
        <div className={s.gold} />
        <div className={s.chaseRing} />
        <div ref={register(n.id, "flash")} className={s.flash} />
        <span className={s.rank}>{row.votes > 0 ? row.rank : "–"}</span>
        <div className={s.name}>
          <span className={s.nick}>{n.nickname}</span>
          <span className={s.chip}>{n.group}</span>
        </div>
        <div className={s.track}>
          <div className={s.bar} style={{ transform: `scaleX(${frac})` }} />
        </div>
        <div className={s.flag}>
          <FireIcon className={s.fire} aria-hidden />
          <div ref={register(n.id, "badge")} className={s.badge}>
            <ArrowTrendingUpIcon width={24} height={24} aria-hidden style={{ display: "inline", marginRight: 6, verticalAlign: -3 }} />
            แซง!
          </div>
        </div>
        <Count value={row.votes} hidden={hide} className={s.count} />
      </div>
    </div>
  );
});

const Photo = memo(function Photo({
  n,
  slot,
  register,
}: {
  n: Nominee;
  slot: number;
  register: LaneProps["register"];
}) {
  const p = photoPlace(slot);
  return (
    <div
      className={s.photo}
      data-photo={n.id}
      style={{ ...groupVars(n.group), transform: `translate(${p.x}px, ${p.y}px) scale(${p.s})` }}
    >
      <div ref={register(n.id, "face")} className={s.photoInner}>
        {/* eslint-disable-next-line @next/next/no-img-element -- pre-sized WebP, no optimizer (SPEC 4.0) */}
        <img src={photoSrc(n.id, 120)} width={PHOTO_W} height={PHOTO_H} alt={`${n.nickname} ${n.group}`} decoding="async" />
      </div>
    </div>
  );
});

const StripItem = memo(function StripItem({
  n,
  slot,
  votes,
  hide,
}: {
  n: Nominee;
  slot: number;
  votes: number;
  hide: boolean;
}) {
  const inStrip = slot >= LANES;
  const x = inStrip ? photoPlace(slot).x - (STRIP_STEP - STRIP_PHOTO_W) / 2 : PAD;
  const y = inStrip ? STRIP_TOP + 4 + PHOTO_H * STRIP_SCALE + 2 : laneY(slot) + LANE_H;
  return (
    <div
      className={s.stripItem}
      aria-hidden={!inStrip}
      style={{ ...groupVars(n.group), width: STRIP_STEP, transform: `translate(${x}px, ${y}px)`, opacity: inStrip ? 1 : 0 }}
    >
      <div className={s.stripNick}>{n.nickname}</div>
      <Count value={votes} hidden={hide} className={s.stripCount} />
    </div>
  );
});

// The first time Chrome draws each kind of effect (light dot, badge, gold lane, stamp…) the GPU
// process compiles a pipeline for it — a 100–280 ms hitch measured in M2. Lobby and pending play
// every effect once, almost transparent, so the first real votes do not stutter.
export function WarmUp() {
  const parts = useRef(new Map<number, Parts>());
  const fx = useRef<HTMLDivElement>(null);
  const [register] = useState(() => (id: number, key: keyof Parts) => (el: HTMLDivElement | null) => {
    const p = parts.current.get(id) ?? {};
    p[key] = el;
    parts.current.set(id, p);
  });
  useEffect(() => {
    const play = () => {
      const p = parts.current.get(1);
      popFace(p?.face);
      flashLane(p?.flash);
      showBadge(p?.badge);
      zoomLane(p?.inner);
      if (fx.current) flyDot(fx.current, { x: BAR_X + BAR_W * 0.6, y: laneY(0) + LANE_H / 2 });
    };
    play();
    const t = setInterval(play, 1600);
    return () => clearInterval(t);
  }, []);
  const a = nomineeById.get(1)!;
  const b = nomineeById.get(2)!;
  return (
    <div className={s.warm} aria-hidden>
      <Lane n={a} row={{ id: 1, votes: 9, rank: 1, slot: 0 }} frac={0.8} hide={false} chasing={false} leader dim={false} register={register} />
      <Lane n={b} row={{ id: 2, votes: 8, rank: 2, slot: 1 }} frac={0.7} hide={false} chasing leader={false} dim register={register} />
      <Photo n={a} slot={0} register={register} />
      <Photo n={b} slot={LANES} register={register} />
      <StripItem n={b} slot={LANES} votes={3} hide={false} />
      <div ref={fx} className={s.fx} />
      <p className={s.emptyCall}>เป็นคนแรกที่โหวต!</p>
      <div className={s.veil} />
      <p className={s.stamp}>ปิดโหวตแล้ว</p>
    </div>
  );
}
