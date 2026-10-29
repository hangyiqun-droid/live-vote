"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { TrophyIcon } from "@heroicons/react/24/solid";
import { nomineeById, type Group } from "@/data/nominees";
import { photoSrc } from "@/components/photo";
import type { AwardState, TallySnapshot } from "@/lib/types";
import { cue, type CueKey } from "./cues";
import { groupVars, PALETTE } from "./palette";
import { podium, type Place } from "./podium";
import r from "./reveal.module.css";

const fmt = (n: number) => n.toLocaleString("th-TH");

type Kind = "title" | "place" | "drum" | "win" | "none";
type Beat = { at: number; kind: Kind; place?: Place; cues?: CueKey[] };

// SPEC 5.3 (~15 s): dim → "และรางวัล … ได้แก่…" → 3rd (left) → 2nd (right) → long drumroll → winner(s)
function timeline(steps: Place[]): Beat[] {
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
// loads (or reloads) on an already revealed award jumps straight to the final picture (SPEC 6.3).
export function Reveal({ award, tally, play }: { award: AwardState; tally: TallySnapshot | undefined; play: boolean }) {
  const pod = useMemo(() => podium(tally?.counts ?? []), [tally]);
  const beats = useMemo(() => timeline(pod.steps), [pod]);
  const [shown, setShown] = useState(play ? 0 : beats.length);
  const confettiRef = useRef<HTMLDivElement>(null);

  // Faces in the scene use the 360 file (≤ 360×480 on screen, SPEC 5.1) — fetch them right away
  useEffect(() => {
    for (const p of pod.steps) for (const id of p.ids) new Image().src = photoSrc(id, 360);
  }, [pod]);

  useEffect(() => {
    if (!play) return;
    const timers = beats.map((b, i) =>
      setTimeout(() => {
        setShown((s) => Math.max(s, i + 1));
        b.cues?.forEach((k) => cue(k, { award_id: award.id }));
        if (b.kind === "win" && b.place && confettiRef.current) {
          confetti(confettiRef.current, b.place.ids.map((id) => nomineeById.get(id)!.group));
        }
      }, b.at),
    );
    return () => timers.forEach(clearTimeout);
    // The scene plays once per mount; later tally messages must not restart it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [play]);

  const seen = (kind: Kind, place?: Place) =>
    beats.slice(0, shown).some((b) => b.kind === kind && (!place || b.place === place));
  const at = (place: Place | null) => (place && (seen("place", place) || seen("win", place)) ? place : null);
  const drumming = seen("drum") && !seen("win");
  const winners = pod.winners && seen("win", pod.winners) ? pod.winners : null;

  return (
    <div className={play ? r.scene : `${r.scene} ${r.still}`} data-reveal={award.id}>
      <div className={r.dim} />
      <div className={seen("title") ? (shown > 1 ? `${r.title} ${r.titleUp}` : r.title) : r.hidden}>
        <p>และรางวัล</p>
        <h1>{award.title}</h1>
        <p>ได้แก่…</p>
      </div>

      <Side place={at(pod.third)} side="left" label="อันดับ 3" />
      <Side place={at(pod.second)} side="right" label="อันดับ 2" />

      {drumming && (
        <div className={r.drum} aria-hidden>
          <span />
          <span />
          <span />
        </div>
      )}

      {winners && (
        <div className={r.center} data-place="1">
          <p className={r.winLabel}>
            <TrophyIcon aria-hidden />
            {winners.ids.length > 1 ? "ผู้ชนะร่วม" : "ผู้ชนะ"}
          </p>
          <div className={r.row}>
            {winners.ids.map((id, i) => (
              <Card key={id} id={id} votes={winners.votes} w={winnerWidth(winners.ids.length)} big delay={i * 140} />
            ))}
          </div>
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

// Centre column is ~720 px wide; side columns ~560 px. Ties share the space instead of overflowing.
const winnerWidth = (n: number) => Math.min(360, Math.floor((720 - 32 * (n - 1)) / n));
const sideWidth = (n: number) => Math.min(240, Math.floor((540 - 24 * (n - 1)) / n));

function Side({ place, side, label }: { place: Place | null; side: "left" | "right"; label: string }) {
  if (!place) return null;
  return (
    <div className={side === "left" ? `${r.side} ${r.left}` : `${r.side} ${r.right}`} data-place={place.rank}>
      <p className={r.placeLabel}>{place.ids.length > 1 ? `${label} (ร่วม)` : label}</p>
      <div className={r.row}>
        {place.ids.map((id, i) => (
          <Card key={id} id={id} votes={place.votes} w={sideWidth(place.ids.length)} delay={i * 120} />
        ))}
      </div>
    </div>
  );
}

function Card({ id, votes, w, big, delay }: { id: number; votes: number; w: number; big?: boolean; delay: number }) {
  const n = nomineeById.get(id)!;
  return (
    <div className={big ? `${r.card} ${r.cardBig}` : r.card} style={{ ...groupVars(n.group), width: w, animationDelay: `${delay}ms` }} data-winner={id}>
      {/* eslint-disable-next-line @next/next/no-img-element -- pre-sized WebP, no optimizer (SPEC 4.0) */}
      <img src={photoSrc(id, 360)} width={w} height={Math.round((w * 4) / 3)} alt={`${n.nickname} ${n.group}`} />
      <div className={r.cardText}>
        <p className={r.cardNick}>{n.nickname}</p>
        {big && <p className={r.cardFirst}>{n.firstName}</p>}
        <span className={r.chip}>{n.group}</span>
        <p className={r.cardVotes}>{fmt(votes)} เสียง</p>
      </div>
    </div>
  );
}

// ~160 paper pieces in the winners' group colours, animated with transform/opacity only (SPEC 5.5)
function confetti(layer: HTMLDivElement, groups: Group[]) {
  const colours = [...new Set(groups.flatMap((g) => PALETTE[g])), "#fde68a", "#ffffff"];
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

// Hall of winners (SPEC 4.1 "ทำเนียบ"): one card per award, shared wins side by side
export function Hall({ awards, tallies }: { awards: AwardState[]; tallies: Record<number, TallySnapshot> }) {
  return (
    <div className={r.hall}>
      <h1 className={r.hallTitle}>ทำเนียบผู้ชนะ</h1>
      <div className={r.hallRow}>
        {awards.map((a, i) => {
          const t = tallies[a.id];
          const win = a.status === "revealed" && t?.round === a.round ? podium(t.counts).winners : null;
          return (
            <div key={a.id} className={r.hallAward} style={{ animationDelay: `${i * 160}ms` }} data-hall={a.id}>
              <p className={r.hallName}>{a.title}</p>
              {a.status !== "revealed" ? (
                <p className={r.hallWait}>ยังไม่ประกาศ</p>
              ) : !win ? (
                <p className={r.hallWait}>ไม่มีผู้ได้รับเสียง</p>
              ) : (
                <>
                  <div className={r.hallFaces}>
                    {win.ids.map((id) => {
                      const n = nomineeById.get(id)!;
                      const w = win.ids.length > 1 ? Math.floor(300 / win.ids.length) : 240;
                      return (
                        <div key={id} className={r.hallFace} style={groupVars(n.group)} data-winner={id}>
                          {/* eslint-disable-next-line @next/next/no-img-element -- pre-sized WebP, no optimizer (SPEC 4.0) */}
                          <img src={photoSrc(id, 360)} width={w} height={Math.round((w * 4) / 3)} alt={`${n.nickname} ${n.group}`} />
                          <p className={r.cardNick}>{n.nickname}</p>
                          <span className={r.chip}>{n.group}</span>
                        </div>
                      );
                    })}
                  </div>
                  {win.ids.length > 1 && <p className={r.hallShared}>ผู้ชนะร่วม</p>}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
