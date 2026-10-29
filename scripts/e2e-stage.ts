// M2 acceptance on the race screen with headless system Chrome at 1920×1080 (fresh temp profile).
// 1. 100 votes in 10 s while recording frames + a DevTools trace (SPEC 5.5)
// 2. every lane/strip position on screen = ranking from the DB (strip climbers land in the right lane)
// 3. the two "ดิว" are told apart · 4. tied scores never swap lanes · 5. hide mode freezes the order
// Screenshots of every state go to docs/qa/evidence/m2/.
// Usage (dev branch only): pnpm build && pnpm start -p 3156 &  then  pnpm e2e:stage [baseUrl]
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { config } from "dotenv";
import { chromium, type Page } from "playwright-core";
import { rankRows } from "../src/app/stage/race";
import { photoPlace } from "../src/app/stage/geometry";
import type { TallySnapshot } from "../src/lib/types";

config({ path: ".env.local", quiet: true });

const base = (process.argv[2] ?? "http://localhost:3156").replace(/\/$/, "") + "";
const K = process.env.STAGE_KEY ?? "";
const OUT = "docs/qa/evidence/m2";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const AWARD = 1;

const problems: string[] = [];
const log: string[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function award(...args: string[]) {
  execFileSync("pnpm", ["-s", "award", ...args], { stdio: "ignore" });
}

async function snapshot(): Promise<TallySnapshot> {
  const j = await (await fetch(`${base}/api/stage/snapshot?k=${encodeURIComponent(K)}`)).json();
  return j.tally;
}

async function vote(nominee: number) {
  const r = await fetch(`${base}/api/vote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ award_id: AWARD, nominee_id: nominee, request_id: randomUUID(), device_id: randomUUID() }),
  });
  const j = (await r.json()) as { result: string };
  if (j.result !== "counted") problems.push(`vote for ${nominee}: ${j.result}`);
}

// 100 votes: lanes 1–10 warm up, then strip people climb (incl. both ดิว), ending with 18 and 25 tied
function burstPlan(): number[] {
  const warm = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].flatMap((id) => [id, id, id]); // 30
  const climb: number[] = [];
  const climbers: Record<number, number> = { 29: 9, 22: 8, 18: 7, 25: 7, 15: 6, 12: 5 }; // 42
  for (let round = 0; round < 9; round++) for (const [id, n] of Object.entries(climbers)) if (round < n) climb.push(Number(id));
  const tail = [1, 29, 2, 22, 3, 15, 4, 12, 5, 6, 7, 8, 9, 10, 11, 13, 14, 16, 17, 19, 20, 21, 23, 24, 26, 27, 28, 1]; // 28
  return [...warm, ...climb, ...tail];
}

type Placed = { id: number; slot: number; photoX: number; photoY: number; laneText: string; count: string };

async function onScreen(page: Page): Promise<Map<number, Placed>> {
  const rows = await page.$$eval("[data-nominee]", (els) =>
    els.map((el) => {
      const id = Number(el.getAttribute("data-nominee"));
      const photo = document.querySelector(`[data-photo="${id}"]`)!.getBoundingClientRect();
      return {
        id,
        slot: Number(el.getAttribute("data-slot")),
        photoX: Math.round(photo.x),
        photoY: Math.round(photo.y),
        laneText: (el as HTMLElement).innerText,
        count: el.querySelector(":scope > div > span:last-child")?.textContent ?? "",
      };
    }),
  );
  return new Map(rows.map((r) => [r.id, r]));
}

async function checkMatchesDb(page: Page, label: string) {
  const snap = await snapshot();
  const expected = rankRows(snap.counts);
  const shown = await onScreen(page);
  let bad = 0;
  for (const r of expected) {
    const s = shown.get(r.id);
    const p = photoPlace(r.slot);
    if (!s || s.slot !== r.slot || Math.abs(s.photoX - p.x) > 2 || Math.abs(s.photoY - p.y) > 2) {
      bad++;
      problems.push(`${label}: nominee ${r.id} expected slot ${r.slot} @${p.x.toFixed(0)},${p.y} got ${JSON.stringify(s)}`);
    }
  }
  log.push(`${label}: total ${snap.total} · ${29 - bad}/29 nominees at the DB rank position (lane + photo)`);
  return { snap, shown };
}

async function main() {
  await mkdir(OUT, { recursive: true });
  award("close", String(AWARD));
  award("reset", String(AWARD));
  award("hide", "off");
  award("current", "lobby");

  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, locale: "th-TH" });
  // tsx (esbuild keepNames) wraps functions passed to evaluate() in __name(); give the page a no-op
  await ctx.addInitScript({ content: "window.__name = (f) => f;" });
  const page = await ctx.newPage();
  page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("response", (r) => r.status() === 404 && problems.push(`404 ${r.url()}`));

  // Lobby → pending → open (empty)
  await page.goto(`${base}/stage?k=${encodeURIComponent(K)}`);
  await page.getByText("รอพิธีกรเปิดรางวัลแรก").waitFor();
  await sleep(800);
  await page.screenshot({ path: `${OUT}/stage-lobby.jpg`, quality: 82 });

  award("current", String(AWARD));
  await page.getByText("สแกนเตรียมไว้ได้เลย").waitFor();
  await sleep(900);
  await page.screenshot({ path: `${OUT}/stage-pending.jpg`, quality: 82 });

  award("open", String(AWARD), "300");
  await page.getByText("เป็นคนแรกที่โหวต!").waitFor();
  await sleep(1200);
  await page.screenshot({ path: `${OUT}/stage-empty.jpg`, quality: 82 });

  // 1. 100 votes in 10 s with frame + long-task recording and a DevTools trace. The recorder starts
  // after the tracer has attached — attaching itself blocks the page for ~50 ms.
  const tracePath = `${OUT}/perf-trace.json`;
  await browser.startTracing(page, { path: tracePath, screenshots: false });
  await sleep(1000);
  await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __long: number[]; __stop: boolean };
    w.__frames = [];
    w.__long = [];
    w.__stop = false;
    let last = performance.now();
    const f = (t: number) => {
      w.__frames.push(t - last);
      last = t;
      if (!w.__stop) requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
    new PerformanceObserver((l) => l.getEntries().forEach((e) => w.__long.push(e.duration))).observe({ type: "longtask" });
  });
  const plan = burstPlan();
  const t0 = Date.now();
  const sent: Promise<void>[] = [];
  for (let i = 0; i < plan.length; i++) {
    await sleep(Math.max(0, t0 + i * 100 - Date.now()));
    sent.push(vote(plan[i]));
  }
  await Promise.all(sent);
  const burstMs = Date.now() - t0;
  await sleep(1500);
  await browser.stopTracing();
  const perf = await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __long: number[]; __stop: boolean };
    w.__stop = true;
    return { frames: w.__frames.slice(1), long: w.__long };
  });
  let run = 0;
  let worstRun = 0;
  for (const d of perf.frames) {
    run = d > 32 ? run + 1 : 0;
    worstRun = Math.max(worstRun, run);
  }
  const sorted = [...perf.frames].sort((a, b) => a - b);
  const p = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const over32 = perf.frames.filter((d) => d > 32).length;
  const fps = (1000 * perf.frames.length) / perf.frames.reduce((a, b) => a + b, 0);
  const perfLine =
    `burst: ${plan.length} votes in ${(burstMs / 1000).toFixed(1)} s · ${perf.frames.length} frames · avg ${fps.toFixed(1)} fps · ` +
    `p50 ${p(0.5).toFixed(1)} ms · p95 ${p(0.95).toFixed(1)} ms · p99 ${p(0.99).toFixed(1)} ms · max ${Math.max(...perf.frames).toFixed(1)} ms · ` +
    `frames > 32 ms: ${over32} · longest run of > 32 ms frames: ${worstRun} (limit 3) · long tasks ≥ 50 ms: ${perf.long.length}` +
    (perf.long.length ? ` (${perf.long.map((d) => d.toFixed(0)).join(", ")} ms)` : "");
  log.push(perfLine);
  if (worstRun > 3) problems.push(`perf: ${worstRun} consecutive frames > 32 ms`);
  if (perf.long.length) problems.push(`perf: ${perf.long.length} long task(s)`);
  await writeFile(`${OUT}/perf-frames.json`, JSON.stringify({ perfLine, frames: perf.frames, long: perf.long }));
  const trace = await readFile(tracePath);
  await writeFile(`${tracePath}.gz`, gzipSync(trace));
  await rm(tracePath);

  await page.screenshot({ path: `${OUT}/stage-race.jpg`, quality: 82 });

  // 2. positions = DB ranking (strip climbers 29, 22, 18, 25, 15, 12 started in the strip)
  const { shown } = await checkMatchesDb(page, "after burst");
  for (const id of [29, 22, 18, 25]) {
    if ((shown.get(id)?.slot ?? 99) >= 8) problems.push(`climber ${id} did not reach a lane`);
  }

  // 3. two ดิว: both in lanes, each with its own group label
  const b18 = shown.get(18)!;
  const b25 = shown.get(25)!;
  const boats = /ดิว[\s\S]*JADE/.test(b18.laneText) && /ดิว[\s\S]*RUBY/.test(b25.laneText);
  log.push(`ดิว: no.18 lane ${b18.slot + 1} "${b18.laneText.replace(/\s+/g, " ")}" · no.25 lane ${b25.slot + 1} "${b25.laneText.replace(/\s+/g, " ")}" → ${boats ? "told apart" : "NOT told apart"}`);
  if (!boats) problems.push("ดิว 18/25 not told apart");

  // 4. tie 18 = 25: watch their lanes for 17 s (covers a 15 s resync) while others get votes
  const snapNow = await snapshot();
  const v = new Map(snapNow.counts);
  if (v.get(18) !== v.get(25)) problems.push(`setup: 18 (${v.get(18)}) and 25 (${v.get(25)}) not tied`);
  let swaps = 0;
  let samples = 0;
  const watchUntil = Date.now() + 17_000;
  const others = [1, 2, 29, 3, 22];
  let k = 0;
  while (Date.now() < watchUntil) {
    if (k < others.length && Date.now() > watchUntil - 16_000 + k * 1500) void vote(others[k++]);
    const s = await onScreen(page);
    samples++;
    if (s.get(18)!.slot > s.get(25)!.slot) swaps++;
    await sleep(100);
  }
  log.push(`tie 18 = 25 (${v.get(18)} each): ${samples} samples over 17 s incl. a resync + ${others.length} other votes → 18 above 25 every time: ${swaps === 0}`);
  if (swaps) problems.push(`tie swapped ${swaps} times`);
  await checkMatchesDb(page, "after tie watch");

  // 5. hide: "?" everywhere, order frozen even when the strip gets votes; un-hide → real order
  const frozen = await onScreen(page);
  award("hide", "on");
  await page.waitForFunction(() => document.querySelector("[data-nominee] > div > span:last-child")?.textContent === "?");
  for (let i = 0; i < 12; i++) await vote(28); // 28 would climb into a lane if not frozen
  await sleep(1200);
  const hidden = await onScreen(page);
  const moved = [...frozen.values()].filter((f) => hidden.get(f.id)!.slot !== f.slot).length;
  const allQ = [...hidden.values()].every((h) => h.count === "?");
  log.push(`hide on: all numbers "?" ${allQ} · lanes moved while hidden: ${moved} (expected 0)`);
  if (!allQ || moved) problems.push("hide mode leaked or moved lanes");
  await page.screenshot({ path: `${OUT}/stage-hidden.jpg`, quality: 82 });
  award("hide", "off");
  await sleep(1500);
  const after = await checkMatchesDb(page, "after un-hide");
  log.push(`un-hide: no.28 now lane ${after.shown.get(28)!.slot + 1}`);
  await page.screenshot({ path: `${OUT}/stage-unhidden.jpg`, quality: 82 });

  // 6. a strip nominee (13 มะลิ, 1 vote) climbs past the 6-vote lanes: badge + flying photo mid-move
  for (let i = 0; i < 6; i++) await vote(13);
  await sleep(380);
  await page.screenshot({ path: `${OUT}/stage-overtake-motion.jpg`, quality: 82 });
  await sleep(1600);
  const climbed = await checkMatchesDb(page, "after strip climb");
  log.push(`strip climb: no.13 now lane ${climbed.shown.get(13)!.slot + 1}`);
  if (climbed.shown.get(13)!.slot >= 8) problems.push("no.13 did not climb into a lane");

  award("close", String(AWARD));
  await page.getByText("ปิดโหวตแล้ว").first().waitFor();
  await sleep(900);
  await page.screenshot({ path: `${OUT}/stage-closed.jpg`, quality: 82 });

  // Frame-time chart for the evidence folder
  const chart = await browser.newPage({ viewport: { width: 1400, height: 520 } });
  await chart.setContent(frameChart(perf.frames, perfLine));
  await chart.screenshot({ path: `${OUT}/perf-frames.png` });

  await browser.close();

  // Leave the dev branch as we found it
  award("reset", String(AWARD));
  award("current", "lobby");

  await writeFile(`${OUT}/RESULT.txt`, [...log, "", problems.length ? `PROBLEMS:\n${problems.join("\n")}` : "no problems"].join("\n") + "\n");
  console.log(log.join("\n"));
  if (problems.length) {
    console.error(`\n${problems.length} problem(s):\n${problems.join("\n")}`);
    process.exit(1);
  }
  console.log("\nall M2 checks passed");
}

function frameChart(frames: number[], title: string): string {
  const w = 1360;
  const h = 400;
  const bw = w / frames.length;
  const y = (ms: number) => h - Math.min(ms, 80) * (h / 80);
  const bars = frames
    .map((d, i) => `<rect x="${(i * bw).toFixed(2)}" y="${y(d).toFixed(1)}" width="${Math.max(bw, 1).toFixed(2)}" height="${(h - y(d)).toFixed(1)}" fill="${d > 32 ? "#ef4444" : d > 17.5 ? "#f59e0b" : "#22c55e"}"/>`)
    .join("");
  const line = (ms: number, c: string, t: string) =>
    `<line x1="0" x2="${w}" y1="${y(ms)}" y2="${y(ms)}" stroke="${c}" stroke-dasharray="6 4"/><text x="4" y="${y(ms) - 4}" fill="${c}" font-size="13">${t}</text>`;
  return `<body style="margin:20px;font:14px system-ui;background:#0b1026;color:#e2e8f0">
<div style="margin-bottom:8px">Frame times on /stage (1920×1080, headless Chrome) during 100 votes in 10 s — ${title.replace(/</g, "&lt;")}</div>
<svg width="${w}" height="${h}" style="background:#111833">${bars}${line(16.7, "#94a3b8", "16.7 ms (60 fps)")}${line(32, "#ef4444", "32 ms")}</svg></body>`;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
