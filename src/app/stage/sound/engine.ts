// Stage sound player on the plain Web Audio API (SPEC 6). One sprite of effects + two music
// loops, three buses (music / effects / reveal scene) into a limiter so a storm of votes can
// never clip. Scenes stay unaware of it: they fire cue("…") and this listens (./cues).
import { withBase } from "@/lib/base-path";
import { lastMusic, onCue, type Cue, type MusicKey } from "../cues";
import {
  BUS_OF,
  DUCK_ATTACK_S,
  DUCK_LEVEL,
  DUCK_RELEASE_S,
  DUCKS,
  MomentRules,
  TickRules,
  type Bus,
} from "./rules";
import { BGM_MS, SPRITE, type SfxKey } from "./sprite";

export type Settings = { muted: boolean; music: boolean; master: number; bgm: number; sfx: number; show: number };
export type EngineState = "loading" | "running" | "blocked" | "failed";

export const DEFAULTS: Settings = { muted: false, music: true, master: 0.8, bgm: 0.55, sfx: 0.8, show: 0.9 };
const STORE = "event:sound";
const MUSIC_FADE_S = 1.5;
const HUSH_LEVEL = 0.15; // music during the reveal scene, under the drumroll
const HUSH_HOLD_MS = 5500; // after the applause starts, bring the music back
const HUSH_MAX_MS = 20_000; // … or anyway after this, e.g. a reveal with no votes has no applause

const FILES = { sfx: "sfx", bgm_lobby: "bgm-lobby", bgm_voting: "bgm-voting" } as const;
type FileKey = keyof typeof FILES;

export function loadSettings(): Settings {
  try {
    const raw = window.localStorage.getItem(STORE);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

function webmOk() {
  return typeof Audio !== "undefined" && new Audio().canPlayType('audio/webm; codecs="opus"') !== "";
}

// Fetch the encoded bytes early (no AudioContext needed yet), decode once the show starts
const bytes = new Map<string, Promise<ArrayBuffer>>();
function fetchBytes(name: string, ext: "webm" | "mp3") {
  const url = withBase(`/audio/${name}.${ext}`);
  let p = bytes.get(url);
  if (!p) {
    p = fetch(url).then((r) => {
      if (!r.ok) throw new Error(String(r.status));
      return r.arrayBuffer();
    });
    p.catch(() => bytes.delete(url));
    bytes.set(url, p);
  }
  return p;
}

export function prefetchSound() {
  const ext = webmOk() ? "webm" : "mp3";
  for (const name of Object.values(FILES)) void fetchBytes(name, ext).catch(() => undefined);
}

export class SoundEngine {
  readonly ctx: AudioContext;
  private master: GainNode;
  private bus: Record<Bus, GainNode>;
  private duck: GainNode; // music only: ducking + hush, separate from the user's music level
  private buffers = new Map<FileKey, AudioBuffer>();
  private music: { key: MusicKey; src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private wantMusic: MusicKey | null = lastMusic();
  private ticks = new TickRules();
  private moments = new MomentRules();
  private playing = new Map<SfxKey, Set<AudioBufferSourceNode>>();
  private hushTimer: ReturnType<typeof setTimeout> | null = null;
  private hushed = false;
  private unsub: () => void;
  private listeners = new Set<(s: EngineState) => void>();
  settings: Settings;
  state: EngineState = "loading";
  /** Tap of the final mix, for the recording on the demo page */
  readonly out: AudioNode;

  constructor(ctx: AudioContext, settings: Settings = loadSettings()) {
    this.ctx = ctx;
    this.settings = settings;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 4;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    this.master = ctx.createGain();
    this.master.connect(limiter).connect(ctx.destination);
    this.out = limiter;
    this.duck = ctx.createGain();
    this.bus = { bgm: ctx.createGain(), sfx: ctx.createGain(), show: ctx.createGain() };
    this.bus.bgm.connect(this.duck).connect(this.master);
    this.bus.sfx.connect(this.master);
    this.bus.show.connect(this.master);
    this.apply(settings, true);
    this.unsub = onCue((c) => this.onCue(c));
    ctx.addEventListener("statechange", () => this.refreshState());
  }

  onState(cb: (s: EngineState) => void): () => void {
    this.listeners.add(cb);
    return () => void this.listeners.delete(cb);
  }

  private setState(s: EngineState) {
    this.state = s;
    this.listeners.forEach((l) => l(s));
  }

  private refreshState() {
    if (this.state === "loading" || this.state === "failed") return;
    this.setState(this.ctx.state === "running" ? "running" : "blocked");
  }

  async load() {
    const webm = webmOk();
    try {
      await Promise.all(
        (Object.keys(FILES) as FileKey[]).map(async (k) => {
          let buf: AudioBuffer;
          try {
            if (!webm) throw new Error("no webm");
            buf = await this.ctx.decodeAudioData((await fetchBytes(FILES[k], "webm")).slice(0));
          } catch {
            // Safari may play WebM in <audio> yet refuse to decode it — mp3 always works
            buf = await this.ctx.decodeAudioData((await fetchBytes(FILES[k], "mp3")).slice(0));
          }
          this.buffers.set(k, buf);
        }),
      );
    } catch {
      this.setState("failed");
      return;
    }
    this.setState(this.ctx.state === "running" ? "running" : "blocked");
    this.startMusic(this.wantMusic);
  }

  async resume() {
    try {
      await this.ctx.resume();
    } catch {
      /* still blocked — the corner button stays */
    }
    this.refreshState();
  }

  close() {
    this.unsub();
    if (this.hushTimer) clearTimeout(this.hushTimer);
    void this.ctx.close().catch(() => undefined);
  }

  apply(next: Settings, instant = false) {
    this.settings = next;
    try {
      window.localStorage.setItem(STORE, JSON.stringify(next));
    } catch {
      /* private mode: settings just are not remembered */
    }
    const t = this.ctx.currentTime;
    const set = (g: GainNode, v: number) =>
      instant ? g.gain.setValueAtTime(v, t) : g.gain.setTargetAtTime(v, t, 0.05);
    set(this.master, next.muted ? 0 : next.master);
    set(this.bus.bgm, next.music ? next.bgm : 0);
    set(this.bus.sfx, next.sfx);
    set(this.bus.show, next.show);
  }

  // ---- music -------------------------------------------------------------------------------

  private startMusic(key: MusicKey | null) {
    this.wantMusic = key;
    if (this.music?.key === key) return;
    const t = this.ctx.currentTime;
    if (this.music) {
      const old = this.music;
      old.gain.gain.setValueAtTime(old.gain.gain.value, t);
      old.gain.gain.linearRampToValueAtTime(0, t + MUSIC_FADE_S);
      old.src.stop(t + MUSIC_FADE_S + 0.05);
      this.music = null;
    }
    const buf = key && this.buffers.get(key);
    if (!key || !buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.loopEnd = Math.min(buf.duration, BGM_MS[key] / 1000);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(1, t + MUSIC_FADE_S);
    src.connect(gain).connect(this.bus.bgm);
    src.start(t);
    this.music = { key, src, gain };
  }

  private duckFor(seconds: number) {
    if (this.hushed) return;
    const g = this.duck.gain;
    const t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(DUCK_LEVEL, t + DUCK_ATTACK_S);
    g.setValueAtTime(DUCK_LEVEL, t + Math.max(DUCK_ATTACK_S, seconds));
    g.linearRampToValueAtTime(1, t + Math.max(DUCK_ATTACK_S, seconds) + DUCK_RELEASE_S);
  }

  private hush(on: boolean) {
    this.hushed = on;
    const g = this.duck.gain;
    const t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(on ? HUSH_LEVEL : 1, t + (on ? 0.6 : 2.5));
  }

  // ---- effects -----------------------------------------------------------------------------

  private play(key: SfxKey, { delay = 0, gain = 1, rate = 1 } = {}) {
    const buf = this.buffers.get("sfx");
    if (!buf) return;
    const [startMs, durMs] = SPRITE[key];
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(this.bus[BUS_OF(key)]);
    const at = this.ctx.currentTime + delay / 1000;
    src.start(at, startMs / 1000, durMs / 1000);
    const set = this.playing.get(key) ?? new Set();
    set.add(src);
    this.playing.set(key, set);
    src.onended = () => set.delete(src);
    if (DUCKS.has(key)) this.duckFor(durMs / 1000);
  }

  private stop(key: SfxKey, fade = 0.15) {
    const t = this.ctx.currentTime;
    for (const src of this.playing.get(key) ?? []) {
      try {
        src.stop(t + fade);
      } catch {
        /* already stopped */
      }
    }
  }

  private onCue({ key, detail }: Cue) {
    if (key === "bgm_lobby" || key === "bgm_voting" || key === "bgm_off") {
      this.startMusic(key === "bgm_off" ? null : key);
      return;
    }
    if (this.state !== "running") return; // a blocked context would queue sounds and dump them later
    const now = performance.now();
    switch (key) {
      case "sfx_tick": {
        const n = typeof detail?.votes === "number" ? detail.votes : 1;
        for (const p of this.ticks.votes(n, now)) this.play(p.key, p);
        return;
      }
      case "sfx_overtake":
      case "sfx_leader":
      case "sfx_chase":
        if (this.moments.allow(key, now)) this.play(key);
        return;
      case "sfx_drumroll":
        // The scene starts the roll twice (title, then before the winner) — never stack two
        this.stop("sfx_drumroll", 0.05);
        if (this.hushTimer) clearTimeout(this.hushTimer);
        this.hushTimer = setTimeout(() => this.hush(false), HUSH_MAX_MS);
        this.hush(true);
        this.play(key);
        return;
      case "sfx_place":
        this.stop("sfx_drumroll");
        this.play(key);
        return;
      case "sfx_reveal":
        this.stop("sfx_drumroll", 0.05);
        this.play(key);
        return;
      case "sfx_applause":
        this.play(key);
        if (this.hushTimer) clearTimeout(this.hushTimer);
        this.hushTimer = setTimeout(() => this.hush(false), HUSH_HOLD_MS);
        return;
      default:
        this.play(key);
    }
  }
}
