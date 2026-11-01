// Pure "how loud and how often" rules for the stage sounds. No Web Audio here —
// the engine asks these what to play; unit-tested in tests/sound-rules.test.ts.
import type { SfxKey } from "./sprite";

export const TICKS_PER_SEC = 6; // sfx_tick at most 6 a second …
export const BURST_GAP_MS = 300; // … beyond that one sfx_burst per 300 ms instead
export const BURST_AT = 4; // ≥ 4 votes landing together (one 250 ms commit) = a burst
export const TICK_SPREAD_MS = 55; // votes in one commit are spaced out, not stacked
export const QUIET_RESET_MS = 2000; // tick volume recovers after 2 s of silence
const TICK_FADE = 0.9; // each tick in a streak is a bit softer …
const TICK_FLOOR = 0.4; // … down to 40 %
const PITCH = 0.1; // ±10 % so the same pop never repeats exactly

export type Play = { key: SfxKey; delay: number; gain: number; rate: number };

export class TickRules {
  private ticks: number[] = [];
  private lastBurst = -Infinity;
  private lastVote = -Infinity;
  private level = 1;

  constructor(private rand: () => number = Math.random) {}

  votes(n: number, now: number): Play[] {
    if (n <= 0) return [];
    if (now - this.lastVote > QUIET_RESET_MS) this.level = 1;
    this.lastVote = now;
    this.ticks = this.ticks.filter((t) => now - t < 1000);

    const out: Play[] = [];
    let overflow = n >= BURST_AT;
    for (let i = 0; i < n && !overflow; i++) {
      const at = now + i * TICK_SPREAD_MS;
      if (this.ticks.length >= TICKS_PER_SEC) {
        overflow = true;
        break;
      }
      this.ticks.push(at);
      out.push({ key: "sfx_tick", delay: i * TICK_SPREAD_MS, gain: this.level, rate: 1 + (this.rand() * 2 - 1) * PITCH });
      this.level = Math.max(TICK_FLOOR, this.level * TICK_FADE);
    }
    if (overflow && now - this.lastBurst >= BURST_GAP_MS) {
      this.lastBurst = now;
      out.push({ key: "sfx_burst", delay: 0, gain: Math.max(0.6, this.level), rate: 1 });
      this.level = Math.max(TICK_FLOOR, this.level * TICK_FADE);
    }
    return out;
  }
}

// Minimum gap between two plays of the same "moment" sound, and who beats whom
export const MIN_GAP_MS: Partial<Record<SfxKey, number>> = {
  sfx_overtake: 1500,
  sfx_leader: 1200,
  sfx_chase: 3000,
};

export class MomentRules {
  private last = new Map<SfxKey, number>();

  allow(key: SfxKey, now: number): boolean {
    // A new leader also counts as an overtake: no second whoosh right after the sting
    if (key === "sfx_overtake" && now - (this.last.get("sfx_leader") ?? -Infinity) < MIN_GAP_MS.sfx_overtake!) return false;
    if (key === "sfx_chase") {
      const busy = ["sfx_leader", "sfx_overtake"] as const;
      if (busy.some((k) => now - (this.last.get(k) ?? -Infinity) < 1000)) return false;
    }
    const gap = MIN_GAP_MS[key];
    if (gap !== undefined && now - (this.last.get(key) ?? -Infinity) < gap) return false;
    this.last.set(key, now);
    return true;
  }
}

// Sounds that push the music down by half for a moment
export const DUCKS: ReadonlySet<SfxKey> = new Set(["sfx_overtake", "sfx_leader", "sfx_open", "sfx_close", "sfx_reveal"]);
export const DUCK_LEVEL = 0.5;
export const DUCK_ATTACK_S = 0.3;
export const DUCK_RELEASE_S = 0.9;

// The reveal scene plays on its own bus so the MC can balance it against the race sounds
export type Bus = "bgm" | "sfx" | "show";
export const BUS_OF = (key: SfxKey): Bus =>
  key === "sfx_drumroll" || key === "sfx_place" || key === "sfx_reveal" || key === "sfx_applause" ? "show" : "sfx";
