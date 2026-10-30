// Builds the stage sound files from the downloaded CC0 sources (SPEC 6.1–6.2, credits in
// public/audio/CREDITS.md): trims each source, evens out loudness, joins every effect into one
// sprite, and turns the two music beds into seamless loops. Writes .webm (Opus) + .mp3 and the
// sprite map src/app/stage/sound/sprite.ts.
// Usage: pnpm audio <folder with the source files named as in RECIPE>  (needs ffmpeg)
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

type Part = { file: string; start?: number; dur?: number; at?: number; gain?: number };
type Sfx = { key: string; parts: Part[]; fadeIn?: number; fadeOut?: number; level: number };

// level = target mean loudness (dB) after normalising; the true peak is capped at -1 dB
const RECIPE: Sfx[] = [
  { key: "sfx_tick", parts: [{ file: "k_pluck_001.ogg" }], level: -22 },
  { key: "sfx_burst", parts: [{ file: "k_chips-handle-1.ogg", dur: 0.6 }], fadeOut: 0.15, level: -24 },
  {
    key: "sfx_overtake",
    parts: [
      { file: "fs_449996.mp3", start: 0.05, dur: 0.55 },
      { file: "k_confirmation_001.ogg", at: 0.32, gain: -3 },
    ],
    fadeOut: 0.1,
    level: -20,
  },
  { key: "sfx_leader", parts: [{ file: "k_jingles_HIT15.ogg" }], fadeOut: 0.1, level: -18 },
  { key: "sfx_chase", parts: [{ file: "k_phaserUp3.ogg", dur: 0.5 }], fadeIn: 0.05, fadeOut: 0.1, level: -26 },
  { key: "sfx_open", parts: [{ file: "k_jingles_STEEL07.ogg" }], fadeOut: 0.15, level: -18 },
  { key: "sfx_count", parts: [{ file: "k_tick_004.ogg" }], level: -20 },
  { key: "sfx_close", parts: [{ file: "fs_436486.mp3", dur: 2.0 }], fadeOut: 0.8, level: -20 },
  { key: "sfx_drumroll", parts: [{ file: "fs_191718.mp3", start: 0.1, dur: 3.8 }], fadeIn: 0.05, fadeOut: 0.15, level: -20 },
  { key: "sfx_place", parts: [{ file: "k_jingles_HIT11.ogg" }], fadeOut: 0.1, level: -19 },
  { key: "sfx_reveal", parts: [{ file: "fs_807997.mp3", dur: 2.6 }], fadeOut: 1.2, level: -19 },
  { key: "sfx_applause", parts: [{ file: "fs_221567.mp3", start: 0.3, dur: 6.0 }], fadeIn: 0.3, fadeOut: 1.8, level: -20 },
];

// Music beds: loudness-normalised quieter than effects, loop seam hidden by a crossfade
const BGM = [
  { key: "bgm_lobby", file: "fs_704972.mp3", lufs: -21, xfade: 2 },
  { key: "bgm_voting", file: "fs_512340.mp3", lufs: -21, xfade: 2 },
];

const GAP = 0.4; // silence between sprite entries so a slightly late stop never bleeds
const RATE = 44100;

const ff = (args: string[]) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
const probe = (file: string) =>
  Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString());

// volumedetect logs to stderr, so run it through a shell that folds stderr into stdout
function levels(file: string) {
  const log = execFileSync("sh", ["-c", 'ffmpeg -hide_banner -i "$1" -af volumedetect -f null - 2>&1', "sh", file]).toString();
  const mean = Number(/mean_volume: (-?[\d.]+)/.exec(log)?.[1]);
  const max = Number(/max_volume: (-?[\d.]+)/.exec(log)?.[1]);
  return { mean, max };
}

function encode(wav: string, outBase: string) {
  ff(["-i", wav, "-c:a", "libopus", "-b:a", "96k", "-vbr", "on", `${outBase}.webm`]);
  ff(["-i", wav, "-c:a", "libmp3lame", "-q:a", "4", `${outBase}.mp3`]);
}

function main() {
  const srcDir = process.argv[2];
  if (!srcDir) throw new Error("usage: pnpm audio <source folder>");
  const src = (f: string) => resolve(srcDir, f);
  const root = resolve(__dirname, "..");
  const outDir = join(root, "public/audio");
  mkdirSync(outDir, { recursive: true });
  const tmp = mkdtempSync(join(tmpdir(), "event-audio-"));

  try {
    // 1) each effect → its own normalised stereo WAV
    const sprite: Record<string, [number, number]> = {};
    const pieces: string[] = [];
    let cursor = 0;
    for (const s of RECIPE) {
      const raw = join(tmp, `${s.key}.raw.wav`);
      const inputs = s.parts.flatMap((p) => ["-i", src(p.file)]);
      const chains = s.parts.map((p, i) => {
        const f = [`aresample=${RATE}`, "aformat=channel_layouts=stereo"];
        if (p.start || p.dur) f.push(`atrim=start=${p.start ?? 0}${p.dur ? `:duration=${p.dur}` : ""}`, "asetpts=PTS-STARTPTS");
        if (p.gain) f.push(`volume=${p.gain}dB`);
        if (p.at) f.push(`adelay=${Math.round(p.at * 1000)}:all=1`);
        return `[${i}:a]${f.join(",")}[p${i}]`;
      });
      const mix =
        s.parts.length > 1
          ? `${s.parts.map((_, i) => `[p${i}]`).join("")}amix=inputs=${s.parts.length}:normalize=0:duration=longest[m]`
          : `[p0]anull[m]`;
      ff([...inputs, "-filter_complex", [...chains, mix].join(";"), "-map", "[m]", raw]);

      const len = probe(raw);
      const fades = [
        s.fadeIn ? `afade=t=in:d=${s.fadeIn}` : "",
        s.fadeOut ? `afade=t=out:st=${Math.max(0, len - s.fadeOut)}:d=${s.fadeOut}` : "",
      ].filter(Boolean);
      const { mean, max } = levels(raw);
      const gain = Math.min(s.level - mean, -1 - max);
      const done = join(tmp, `${s.key}.wav`);
      ff(["-i", raw, "-af", [...fades, `volume=${gain.toFixed(2)}dB`].join(","), "-ar", String(RATE), done]);
      const d = probe(done);
      sprite[s.key] = [Math.round(cursor * 1000), Math.round(d * 1000)];
      pieces.push(done);
      cursor += d + GAP;
      console.log(`${s.key.padEnd(14)} ${d.toFixed(2)} s  gain ${gain.toFixed(1)} dB`);
    }

    // 2) join with silence → one sprite file
    const silence = join(tmp, "gap.wav");
    ff(["-f", "lavfi", "-i", `anullsrc=r=${RATE}:cl=stereo`, "-t", String(GAP), silence]);
    const list = join(tmp, "list.txt");
    writeFileSync(list, pieces.flatMap((p) => [`file '${p}'`, `file '${silence}'`]).join("\n"));
    const spriteWav = join(tmp, "sfx.wav");
    ff(["-f", "concat", "-safe", "0", "-i", list, "-c", "pcm_s16le", spriteWav]);
    encode(spriteWav, join(outDir, "sfx"));

    // 3) music beds: y = x[0, L-d) with x[L-d, L) faded out over a faded-in head → seamless loop
    const bgm: Record<string, number> = {};
    for (const b of BGM) {
      const len = probe(src(b.file));
      const d = b.xfade;
      const wav = join(tmp, `${b.key}.wav`);
      const graph = [
        `[0:a]aresample=${RATE},aformat=channel_layouts=stereo,asplit=3[a][b][c]`,
        `[a]atrim=0:${d},asetpts=PTS-STARTPTS,afade=t=in:d=${d}:curve=qsin[head]`,
        `[b]atrim=${len - d}:${len},asetpts=PTS-STARTPTS,afade=t=out:d=${d}:curve=qsin[tail]`,
        `[head][tail]amix=inputs=2:normalize=0[seam]`,
        `[c]atrim=${d}:${len - d},asetpts=PTS-STARTPTS[body]`,
        `[seam][body]concat=n=2:v=0:a=1,loudnorm=I=${b.lufs}:TP=-2:LRA=11,aresample=${RATE}[out]`,
      ].join(";");
      ff(["-i", src(b.file), "-filter_complex", graph, "-map", "[out]", wav]);
      encode(wav, join(outDir, b.key.replace("_", "-")));
      bgm[b.key] = Math.round(probe(wav) * 1000);
      console.log(`${b.key.padEnd(14)} ${(bgm[b.key] / 1000).toFixed(1)} s loop`);
    }

    const ts = `// Generated by scripts/make-audio.ts — do not edit by hand. [start ms, duration ms] in sfx.webm/.mp3
export const SPRITE = {
${Object.entries(sprite).map(([k, v]) => `  ${k}: [${v.join(", ")}],`).join("\n")}
} as const;

export type SfxKey = keyof typeof SPRITE;

// Loop length of each music bed (ms)
export const BGM_MS = {
${Object.entries(bgm).map(([k, v]) => `  ${k}: ${v},`).join("\n")}
} as const;
`;
    mkdirSync(join(root, "src/app/stage/sound"), { recursive: true });
    writeFileSync(join(root, "src/app/stage/sound/sprite.ts"), ts);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main();
