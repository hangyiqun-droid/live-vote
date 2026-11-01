// Latency: time from "phone presses confirm" (POST /api/vote) to the tally message reaching
// a stage subscriber on Ably. Votes one at a time with fresh device ids into the open award.
// Usage: pnpm latency [baseUrl] [count]   e.g. pnpm latency https://<preview>.vercel.app 20
// Needs an open award (pnpm award open 1). Dev branch / Ably dev app only.
// Sends VERCEL_AUTOMATION_BYPASS_SECRET from .env.local when set (protected preview).
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import * as Ably from "ably";
import { CHANNEL_TALLY, type EventState, type TallySnapshot } from "../src/lib/types";

config({ path: ".env.local", quiet: true });

const base = (process.argv[2] ?? "http://localhost:3155").replace(/\/$/, "") + (process.env.NEXT_PUBLIC_BASE_PATH ?? "");
const count = Number(process.argv[3] ?? 20);
// A protected preview needs the bypass on every request (same env name as the load test)
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const get = (url: string, init: RequestInit = {}) => {
  const headers = new Headers(init.headers);
  if (BYPASS) headers.set("x-vercel-protection-bypass", BYPASS);
  return fetch(url, { ...init, headers });
};

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};

async function main() {
  const state = (await (await get(`${base}/api/state`)).json()) as EventState;
  const award = state.awards.find((a) => a.status === "open");
  if (!award) throw new Error("no open award — run: pnpm award open 1");

  const ably = new Ably.Realtime({ key: process.env.ABLY_API_KEY! });
  const channel = ably.channels.get(CHANNEL_TALLY);
  let waiting: { total: number; resolve: (t: number) => void } | null = null;
  await channel.subscribe("tally", (m) => {
    const s = m.data as TallySnapshot;
    if (waiting && s.award_id === award.id && s.total >= waiting.total) {
      waiting.resolve(performance.now());
      waiting = null;
    }
  });

  let total = await currentTotal();
  const endToEnd: number[] = [];
  const http: number[] = [];
  for (let i = 0; i < count; i++) {
    const nominee = (i % 29) + 1;
    const t0 = performance.now();
    const arrived = new Promise<number>((resolve) => (waiting = { total: total + 1, resolve }));
    const res = await get(`${base}/api/vote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ award_id: award.id, nominee_id: nominee, request_id: randomUUID(), device_id: randomUUID() }),
    });
    const t1 = performance.now();
    const body = (await res.json()) as { result: string };
    if (body.result !== "counted") throw new Error(`vote ${i}: ${body.result}`);
    const t2 = await Promise.race([arrived, new Promise<number>((r) => setTimeout(() => r(NaN), 5_000))]);
    if (Number.isNaN(t2)) throw new Error(`vote ${i}: tally message never arrived`);
    total += 1;
    http.push(t1 - t0);
    endToEnd.push(t2 - t0);
    await new Promise((r) => setTimeout(r, 300));
  }
  ably.close();

  const fmt = (xs: number[]) =>
    `p50 ${pct(xs, 50).toFixed(0)} ms · p95 ${pct(xs, 95).toFixed(0)} ms · max ${Math.max(...xs).toFixed(0)} ms`;
  console.log(`target ${base} · ${count} votes into award ${award.id}`);
  console.log(`POST /api/vote round trip : ${fmt(http)}`);
  console.log(`press → tally on Ably sub  : ${fmt(endToEnd)}`);

  async function currentTotal(): Promise<number> {
    const r = await get(`${base}/api/stage/snapshot?k=${encodeURIComponent(process.env.STAGE_KEY ?? "")}`);
    const j = (await r.json()) as { tally: TallySnapshot | null };
    return j.tally?.total ?? 0;
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
