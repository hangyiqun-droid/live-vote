"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { TrophyIcon } from "@heroicons/react/24/solid";
import { nomineeById, type Group } from "@/data/nominees";
import { Avatar } from "@/components/avatar";
import type { AwardState, TallySnapshot } from "@/lib/types";
import { cue, type CueKey } from "./cues";
import { groupVars, PALETTE } from "./palette";
import { podium, type Place } from "./podium";
import { fitTitle } from "./title-fit";
import r from "./reveal.module.css";

const fmt = (n: number) => n.toLocaleString("th-TH");
const TIE_NOTE = ["คะแนนเท่ากัน", "ถึงคะแนนนี้ก่อน"];

export type Kind = "title" | "place" | "drum" | "win" | "none";
export type Beat = { at: number; kind: Kind; place?: Place; cues?: CueKey[] };

// (~15 s): dim → "และรางวัล … ได้แก่…" → 3rd (left) → 2nd (right) → long drumroll → winner
export function timeline(steps: Place[]): Beat[] {
  const beats: Beat[] = [{ at: 800, kind: "title", cues: ["sfx_drumroll"] }];
  if (!steps.length) return [...beats, { at: 3200, kind: "none" }];
  let t = 3400;
  for (const p of steps.slice(0, -1)) {
    beats.push({ at: t, kind: "place", place: p, cues: ["sfx_place"] });
    t += 2600;
  }
  beats.push({ at: t - 600, kind: "drum", cues: ["sfx_drumroll"] });
  beats.push({ at: t + 3200, kind: "win", place: steps[steps.length - 1], cues: ["sfx_reveal", "sfx_applause"] });
  return beats;
}

// The reveal scene. `play` = the MC pressed "ประกาศผล" while this screen watched; a screen that
// loads (or reloads) on an already revealed award jumps straight to the final picture.
export function Reveal({ award, tally, play }: { award: AwardState; tally: TallySnapshot | undefined; play: boolean }) {
  const pod = useMemo(() => podium(tally?.counts ?? [], tally?.order), [tally]);
  const beats = useMemo(() => timeline(pod.steps), [pod]);
  const [played, setShown] = useState(0);
  // A still screen always shows every beat — counted from the current podium, because the tally
  // can land a moment after the "revealed" state (it used to freeze on the empty podium's 2 beats)
  const shown = play ? played : beats.length;
  const confettiRef = useRef<HTMLDivElement>(null);

  // The timeline is built from the podium, so it must not start before the tally has arrived —
  // a screen that hears "revealed" first (tallies commit every 250 ms) would otherwise schedule the
  // beats of an empty podium and stall on 3rd place
  const ready = tally !== undefined;
  useEffect(() => {
    if (!play || !ready) return;
    const timers = beats.map((b, i) =>
      setTimeout(() => {
        setShown((s) => Math.max(s, i + 1));
        b.cues?.forEach((k) => cue(k, { award_id: award.id }));
        if (b.kind === "win" && b.place && confettiRef.current) {
          confetti(confettiRef.current, nomineeById.get(b.place.id)!.group);
        }
      }, b.at),
    );
    return () => timers.forEach(clearTimeout);
    // The scene plays once per mount (once the tally is in); later tally messages must not restart it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [play, ready]);

  const seen = (kind: Kind, place?: Place) =>
    beats.slice(0, shown).some((b) => b.kind === kind && (!place || b.place === place));
  const at = (place: Place | null) => (place && (seen("place", place) || seen("win", place)) ? place : null);
  const drumming = seen("drum") && !seen("win");
  const winner = pod.first && seen("win", pod.first) ? pod.first : null;

  return (
    <div className={play ? r.scene : `${r.scene} ${r.still}`} data-reveal={award.id}>
      <div className={r.dim} />
      <div className={seen("title") ? (shown > 1 ? `${r.title} ${r.titleUp}` : r.title) : r.hidden}>
        <p>และรางวัล</p>
        <h1 style={{ fontSize: fitTitle(award.title, 124, 1780) }}>{award.title}</h1>
        <p>ได้แก่…</p>
      </div>

      <Side place={at(pod.third)} className={r.third} label="อันดับ 3" />
      <Side place={at(pod.second)} className={r.second} label="อันดับ 2" />

      {drumming && (
        <div className={r.drum} aria-hidden>
          <span />
          <span />
          <span />
        </div>
      )}

      {winner && (
        <div className={r.center} data-place="1">
          <p className={r.winLabel}>
            <TrophyIcon aria-hidden />
            ผู้ชนะ
          </p>
          <Card place={winner} big />
        </div>
      )}

      {seen("none") && (
        <div className={r.none} role="status">
          ยังไม่มีผู้ได้รับเสียง
        </div>
      )}

      <div ref={confettiRef} className={r.confetti} aria-hidden />
    </div>
  );
}

function Side({ place, className, label }: { place: Place | null; className: string; label: string }) {
  if (!place) return null;
  return (
    <div className={`${r.side} ${className}`} data-place={place.rank}>
      <p className={r.placeLabel}>{label}</p>
      <Card place={place} />
    </div>
  );
}

function Card({ place, big }: { place: Place; big?: boolean }) {
  const n = nomineeById.get(place.id)!;
  return (
    <div className={big ? `${r.card} ${r.cardBig}` : r.card} style={groupVars(n.group)} data-winner={place.id}>
      <div className={r.cardPhoto}>
        <Avatar nominee={n} size={big ? 300 : 200} ring="var(--g2)" ringPx={big ? 8 : 6} />
        {place.wonTie && (
          <p className={r.tieBand}>
            {TIE_NOTE[0]}
            <br />
            {TIE_NOTE[1]}
          </p>
        )}
      </div>
      <div className={r.cardText}>
        <p className={r.cardNick}>{n.nickname}</p>
        {big && <p className={r.cardFirst}>{n.firstName}</p>}
        <span className={r.chip}>{n.group}</span>
        <p className={r.cardVotes}>{fmt(place.votes)} เสียง</p>
      </div>
    </div>
  );
}

// ~160 paper pieces in the winner's group colours, animated with transform/opacity only
function confetti(layer: HTMLDivElement, group: Group) {
  const colours = [...PALETTE[group], "#fde68a", "#ffffff"];
  for (let i = 0; i < 160; i++) {
    const p = document.createElement("i");
    p.style.background = colours[i % colours.length];
    p.style.left = `${960 + (Math.random() - 0.5) * 300}px`;
    layer.appendChild(p);
    const dx = (Math.random() - 0.5) * 1800;
    const up = 300 + Math.random() * 500;
    const fall = 900 + Math.random() * 400;
    const spin = (Math.random() - 0.5) * 1440;
    const a = p.animate(
      [
        { transform: "translate(0, 0) rotate(0deg)", opacity: 1 },
        { transform: `translate(${dx * 0.6}px, ${-up}px) rotate(${spin * 0.4}deg)`, opacity: 1, offset: 0.3 },
        { transform: `translate(${dx}px, ${fall - up}px) rotate(${spin}deg)`, opacity: 0 },
      ],
      { duration: 2600 + Math.random() * 1600, delay: Math.random() * 300, easing: "cubic-bezier(0.2, 0.6, 0.4, 1)" },
    );
    a.onfinish = () => p.remove();
  }
}

// Hall of winners: one card per award
export function Hall({ awards, tallies }: { awards: AwardState[]; tallies: Record<number, TallySnapshot> }) {
  return (
    <div className={r.hall}>
      <h1 className={r.hallTitle}>ทำเนียบผู้ชนะ</h1>
      <div className={r.hallRow}>
        {awards.map((a, i) => {
          const t = tallies[a.id];
          const win = a.status === "revealed" && t?.round === a.round ? podium(t.counts, t.order).first : null;
          return (
            <div key={a.id} className={r.hallAward} style={{ animationDelay: `${i * 160}ms` }} data-hall={a.id}>
              <p className={r.hallName}>{a.title}</p>
              {a.status !== "revealed" ? (
                <p className={r.hallWait}>ยังไม่ประกาศ</p>
              ) : !win ? (
                <p className={r.hallWait}>ไม่มีผู้ได้รับเสียง</p>
              ) : (
                <HallFace place={win} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HallFace({ place }: { place: Place }) {
  const n = nomineeById.get(place.id)!;
  return (
    <div className={r.hallFace} style={groupVars(n.group)} data-winner={place.id}>
      <div className={r.hallPic}>
        <Avatar nominee={n} size={210} ring="var(--g2)" ringPx={6} />
      </div>
      <p className={r.cardNick}>{n.nickname}</p>
      <span className={r.chip}>{n.group}</span>
      {place.wonTie && (
        <p className={r.hallTie}>
          {TIE_NOTE[0]}
          <br />
          {TIE_NOTE[1]}
        </p>
      )}
    </div>
  );
}
