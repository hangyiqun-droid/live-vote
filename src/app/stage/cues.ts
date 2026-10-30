// Sound hook points (SPEC 6.1). Scenes call cue("sfx_…") at the moment a sound belongs and the
// stage tells which music bed fits the scene with cue("bgm_…"); the player (./sound/engine)
// listens with onCue(). Before the show is started nothing listens and cues cost nothing.
export type MusicKey = "bgm_lobby" | "bgm_voting";

export type CueKey =
  | MusicKey
  | "bgm_off"
  | "sfx_tick"
  | "sfx_burst"
  | "sfx_overtake"
  | "sfx_leader"
  | "sfx_chase"
  | "sfx_open"
  | "sfx_count"
  | "sfx_close"
  | "sfx_drumroll"
  | "sfx_place"
  | "sfx_reveal"
  | "sfx_applause";

export type Cue = { key: CueKey; detail?: Record<string, unknown> };

const EVENT = "event:cue";
let music: MusicKey | null = null;

// The music bed asked for last, so a player started later joins in with the right one
export const lastMusic = () => music;

export function cue(key: CueKey, detail?: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  if (key === "bgm_lobby" || key === "bgm_voting") music = key;
  if (key === "bgm_off") music = null;
  window.dispatchEvent(new CustomEvent<Cue>(EVENT, { detail: { key, detail } }));
}

export function onCue(cb: (c: Cue) => void): () => void {
  const h = (e: Event) => cb((e as CustomEvent<Cue>).detail);
  window.addEventListener(EVENT, h);
  return () => window.removeEventListener(EVENT, h);
}
