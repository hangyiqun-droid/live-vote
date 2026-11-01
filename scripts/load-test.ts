// Load test. Talks to the app only over HTTP + Ably, exactly like phones,
// the stage and the MC do — so the same script runs against local, a preview or prod.
//
//   pnpm load [baseUrl] [--devices 150] [--listeners 100] [--burst 100] [--tally-listeners 1]
//             [--awards 1,2] [--out load-results] [--reset] [--keep] [--yes]
//             [--server-log /tmp/server.log]   (local only: count "[ably] publish … failed" lines)
//             [--spread http://localhost:3156,…]   (local only: also send votes to these instances —
//                                                   round-robin, like Vercel spreading the room
//                                                   over several function instances)
//             [--connections 48]   keep-alive sockets per host (0 = one fresh socket per request)
//             [--no-retry]         report the first answer only — no phone-style resend
//
// 1. opens <listeners> phone connections (role mobile, lv:event only) + <tally-listeners> stage
//    connections (lv:tally) through the app's own /api/realtime/token
// 2. award A: <devices> phones vote at the same instant; 20 of them double-send the same request,
//    then every phone resends (same request → "counted", no double count) and tries a second
//    ballot (new request → "already_voted")
// 3. award B: <burst> votes inside 1 s (near Ably's 500 msg/s account ceiling) → how long until the
//    stage has the true total (over Ably, or at worst the 15 s snapshot resync)
// 4. checks: no vote lost or doubled per nominee · stage total = DB (verify_tallies via the MC
//    overview) · max Ably connections · p50/p95 · 0 × 429 from one shared IP
//
// Everything comes from one machine = one IP, which is the venue Wi-Fi case on purpose.
// One machine is NOT 150 phones at the TCP level, though: measured that opening ~170 new
// TLS sockets at once over a phone hotspot times out even against google.com (UND_ERR_CONNECT_TIMEOUT
// before any request reaches Vercel). So requests share a bounded keep-alive pool (warmed up
// first), and — like the real vote page — a send that never got an answer is resent with the
// same request_id. Every resend is counted and printed; no 5xx answer is ever retried away silently.
// Needs in .env.local: STAGE_KEY, ADMIN_PASSCODE (same values as the target). Optional:
// VERCEL_AUTOMATION_BYPASS_SECRET for a protected preview. Ably quota is per *account* —
// never run this during the real event.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { config } from "dotenv";
import * as Ably from "ably";
import { Agent, fetch as uFetch, type RequestInit as URequestInit } from "undici";
import type { AdminOverview, EventState, TallySnapshot } from "../src/lib/types";
import { CHANNEL_EVENT, CHANNEL_TALLY } from "../src/lib/types";

config({ path: ".env.local", quiet: true });

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const opt = (name: string, def: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const origin = (argv.find((a) => !a.startsWith("--") && /^https?:/.test(a)) ?? "http://localhost:3159").replace(/\/$/, "");
const base = `${origin}${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}`;
const DEVICES = Number(opt("devices", "150"));
const LISTENERS = Number(opt("listeners", "100"));
const TALLY_LISTENERS = Number(opt("tally-listeners", "1"));
const BURST = Number(opt("burst", "100"));
const [AWARD_A, AWARD_B] = opt("awards", "1,2").split(",").map(Number);
const OUT = opt("out", "load-results");
const DOUBLE_SEND = Math.min(20, DEVICES);
const K = process.env.STAGE_KEY ?? "";
const PASS = process.env.ADMIN_PASSCODE ?? "";
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const SERVER_LOG = opt("server-log", "");
const isLocal = /^http:\/\/(localhost|127\.0\.0\.1)/.test(origin);
const CONNECTIONS = Number(opt("connections", "48"));
const RETRY = !flag("no-retry");
const dispatcher = new Agent({
  ...(CONNECTIONS > 0 ? { connections: CONNECTIONS } : {}),
  keepAliveTimeout: 60_000,
  keepAliveMaxTimeout: 120_000,
  connect: { timeout: 20_000 },
  headersTimeout: 30_000,
  bodyTimeout: 30_000,
});
// Votes go round-robin over these; admin/overview/token/snapshot stay on the first one
const voteBases = [base, ...opt("spread", "").split(",").filter(Boolean).map((o) => `${o.replace(/\/$/, "")}${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}`)];
let voteTurn = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log: string[] = [];
const problems: string[] = [];
const say = (s: string) => {
  console.log(s);
  log.push(s);
};
const check = (ok: boolean, what: string) => {
  say(`${ok ? "PASS" : "FAIL"} ${what}`);
  if (!ok) problems.push(what);
};
const pct = (xs: number[], p: number) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
};
const stats = (xs: number[]) =>
  `p50 ${pct(xs, 50).toFixed(0)} ms · p95 ${pct(xs, 95).toFixed(0)} ms · max ${Math.max(...xs).toFixed(0)} ms (n=${xs.length})`;

// ---- HTTP -------------------------------------------------------------------------------------
let adminCookie = "";
const statusCounts = new Map<number, number>();
const networkErrors = new Map<string, number>(); // undici cause code → count (never reached an answer)
const noteNetwork = (e: unknown) => {
  const c = e as { cause?: { code?: string }; code?: string; name?: string };
  const code = c?.cause?.code ?? c?.code ?? c?.name ?? "unknown";
  networkErrors.set(code, (networkErrors.get(code) ?? 0) + 1);
};
const fiveXX = () => [...statusCounts].filter(([s]) => s >= 500).reduce((n, [, c]) => n + c, 0);

// Every request (votes, MC overview/actions, Ably tokens, stage snapshot) carries the bypass header
async function http(path: string, init: URequestInit = {}, cookie = "", target = base) {
  const headers = new Headers(init.headers as HeadersInit | undefined);
  if (BYPASS) headers.set("x-vercel-protection-bypass", BYPASS);
  if (cookie) headers.set("cookie", cookie);
  try {
    const r = await uFetch(`${target}${path}`, { ...init, headers, dispatcher });
    statusCounts.set(r.status, (statusCounts.get(r.status) ?? 0) + 1);
    return r;
  } catch (e) {
    noteNetwork(e);
    throw e;
  }
}

// Open the keep-alive pool before the rush, so the rush is about the app, not about TLS handshakes
async function warmUp() {
  const n = CONNECTIONS > 0 ? CONNECTIONS : 0;
  const t0 = performance.now();
  const out = await Promise.all(
    Array.from({ length: n }, async () => {
      for (let i = 0; i < 3; i++) {
        try {
          const r = await http("/api/health");
          await r.arrayBuffer();
          return true;
        } catch {
          await sleep(500);
        }
      }
      return false;
    }),
  );
  say(`keep-alive pool: ${out.filter(Boolean).length}/${n} sockets warm (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
}

async function login() {
  const r = await http("/api/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ passcode: PASS }),
  });
  if (!r.ok) throw new Error(`MC login failed (${r.status}) — ADMIN_PASSCODE in .env.local must match the target`);
  adminCookie = (r.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(";")[0])
    .filter((c) => c.startsWith("lv_admin="))
    .join("; ");
}

// Read-only, so a 5xx / lost answer is simply asked again (and still counted in statusCounts)
async function overview(): Promise<AdminOverview> {
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await http("/api/admin/overview", {}, adminCookie);
      if (r.ok) return (await r.json()) as AdminOverview;
      if (r.status < 500 || attempt >= 5) throw new Error(`overview ${r.status}`);
    } catch (e) {
      if (attempt >= 5 || (e instanceof Error && e.message.startsWith("overview"))) throw e;
    }
    await sleep(500 * attempt);
  }
}

// MC buttons are idempotent (same status again = "unchanged"), so a 5xx or a lost answer is
// pressed again — the way the MC would — and every extra press is printed
const adminRetries: string[] = [];
async function act(body: Record<string, unknown>, okErrors: string[] = []): Promise<AdminOverview> {
  for (let attempt = 1; ; attempt++) {
    let why: string;
    try {
      const r = await http(
        "/api/admin/action",
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
        adminCookie,
      );
      const j = (await r.json().catch(() => null)) as { ok: boolean; error?: string; overview: AdminOverview } | null;
      if (j?.overview) {
        if (!j.ok && !okErrors.includes(j.error ?? "")) throw new Error(`admin ${body.action}: ${j.error ?? r.status}`);
        return j.overview;
      }
      if (r.status < 500) throw new Error(`admin ${body.action}: HTTP ${r.status}`);
      why = `HTTP ${r.status}`;
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("admin ")) throw e;
      why = "network error";
    }
    adminRetries.push(`${body.action} ${why}`);
    if (attempt >= 6) throw new Error(`admin ${body.action}: ${why} after ${attempt} tries`);
    await sleep(500 * attempt);
  }
}

// Bring an award back to "pending, 0 votes" from whatever state it is in
async function resetAward(id: number) {
  let o = await overview();
  const a = () => o.state.awards.find((x) => x.id === id)!;
  if (a().status === "open") o = await act({ action: "close", award_id: id });
  if (a().status === "revealed") o = await act({ action: "unreveal", award_id: id });
  if (a().status === "closed" || totalOf(o, id) > 0) o = await act({ action: "reset", award_id: id, confirm: a().title });
}

const totalOf = (o: AdminOverview, id: number) => o.tallies.find((t) => t.award_id === id)?.total ?? 0;

type Vote = { device: string; request: string; nominee: number };
type VoteOut = { result: string; ms: number; status: number; resends: number };
let voteResends = 0;

async function sendOnce(award: number, v: Vote): Promise<{ result: string; status: number }> {
  try {
    const target = voteBases[voteTurn++ % voteBases.length];
    const r = await http(
      "/api/vote",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ award_id: award, nominee_id: v.nominee, request_id: v.request, device_id: v.device }),
      },
      "",
      target,
    );
    const j = (await r.json().catch(() => ({}))) as { result?: string };
    return { result: j.result ?? `http_${r.status}`, status: r.status };
  } catch {
    return { result: "network_error", status: 0 };
  }
}

// Like the vote page: no answer → resend the same request_id (the server never counts it twice).
// A 5xx is resent too but stays in statusCounts, so the "no 5xx" check still fails on it.
async function sendVote(award: number, v: Vote): Promise<VoteOut> {
  const t0 = performance.now();
  let out = await sendOnce(award, v);
  let resends = 0;
  while (RETRY && resends < 3 && (out.status === 0 || out.status >= 500)) {
    resends += 1;
    voteResends += 1;
    await sleep(300 * resends);
    out = await sendOnce(award, v);
  }
  return { ...out, ms: performance.now() - t0, resends };
}

// ---- Ably listeners ---------------------------------------------------------------------------
type Listener = { client: Ably.Realtime; role: "mobile" | "stage"; connected: boolean };
const listeners: Listener[] = [];
let connectedNow = 0;
let connectedMax = 0;
let tallyMessages = 0;
let latestTally: TallySnapshot | null = null;
const tallyArrivals: { at: number; snap: TallySnapshot }[] = [];
const eventArrivals = new Map<number, number>(); // version → listeners that heard it

function openListener(role: "mobile" | "stage"): Listener {
  const q = role === "stage" ? `?role=stage&k=${encodeURIComponent(K)}` : "";
  const client = new Ably.Realtime({
    authCallback: async (_params, cb) => {
      try {
        const r = await http(`/api/realtime/token${q}`);
        if (!r.ok) throw new Error(`token ${r.status}`);
        cb(null, (await r.json()) as Ably.TokenRequest);
      } catch (e) {
        cb(e instanceof Error ? e.message : "token failed", null);
      }
    },
    echoMessages: false,
    logLevel: 0,
  } as Ably.ClientOptions);
  const l: Listener = { client, role, connected: false };
  client.connection.on((change) => {
    const was = l.connected;
    l.connected = change.current === "connected";
    if (l.connected !== was) {
      connectedNow += l.connected ? 1 : -1;
      connectedMax = Math.max(connectedMax, connectedNow);
    }
  });
  void client.channels.get(CHANNEL_EVENT).subscribe("state", (m) => {
    const s = m.data as EventState;
    eventArrivals.set(s.version, (eventArrivals.get(s.version) ?? 0) + 1);
  });
  if (role === "stage") {
    void client.channels.get(CHANNEL_TALLY).subscribe("tally", (m) => {
      const s = m.data as TallySnapshot;
      tallyMessages += 1;
      tallyArrivals.push({ at: performance.now(), snap: s });
      // The stage keeps only the newest seq
      if (!latestTally || s.award_id !== latestTally.award_id || s.seq > latestTally.seq) latestTally = s;
    });
  }
  listeners.push(l);
  return l;
}

async function waitFor(cond: () => boolean, ms: number): Promise<number | null> {
  const t0 = performance.now();
  while (performance.now() - t0 < ms) {
    if (cond()) return performance.now() - t0;
    await sleep(25);
  }
  return cond() ? performance.now() - t0 : null;
}

async function stageSnapshot(): Promise<TallySnapshot | null> {
  const r = await http(`/api/stage/snapshot?k=${encodeURIComponent(K)}`);
  return ((await r.json()) as { tally: TallySnapshot | null }).tally;
}

const countsOf = (s: TallySnapshot | null) => new Map((s?.counts ?? []).map(([n, v]) => [n, v]));

function compareCounts(label: string, expected: Map<number, number>, got: Map<number, number>) {
  const diffs: string[] = [];
  for (let n = 1; n <= 29; n++) {
    const e = expected.get(n) ?? 0;
    const g = got.get(n) ?? 0;
    if (e !== g) diffs.push(`#${n} expected ${e} got ${g}`);
  }
  check(diffs.length === 0, `${label}: every nominee's count = votes sent${diffs.length ? ` (${diffs.slice(0, 5).join(", ")})` : ""}`);
}

let logStart = 0;

// ---- main ---------------------------------------------------------------------------------------
async function main() {
  if (!K || !PASS) throw new Error("STAGE_KEY and ADMIN_PASSCODE must be in .env.local");
  if (voteBases.length > 1 && !isLocal) throw new Error("--spread is for local multi-instance runs only");
  if (!isLocal && !flag("yes")) {
    throw new Error(`${origin} is not local — this resets awards ${AWARD_A},${AWARD_B} there. Add --yes if you mean it.`);
  }
  const started = new Date();
  say(`# Load test · ${started.toISOString()}`);
  say(`target ${base}${voteBases.length > 1 ? ` (votes spread over ${voteBases.length} instances)` : ""} · devices ${DEVICES} · phone listeners ${LISTENERS} · stage listeners ${TALLY_LISTENERS} · burst ${BURST}/1 s · awards ${AWARD_A},${AWARD_B}${BYPASS ? " · vercel bypass on" : ""}`);

  logStart = SERVER_LOG ? (await readFile(SERVER_LOG, "utf8")).split("\n").length - 1 : 0;
  const health = await (await http("/api/health")).json();
  say(`health ${JSON.stringify(health)}`);
  await login();

  // Refuse to wipe real votes unless asked to
  let o = await overview();
  const before = [AWARD_A, AWARD_B].map((id) => ({ id, total: totalOf(o, id), status: o.state.awards.find((a) => a.id === id)?.status }));
  if (o.state.awards.some((a) => a.status === "open" && ![AWARD_A, AWARD_B].includes(a.id))) {
    throw new Error("another award is open — close it first (only one award may be open)");
  }
  if (before.some((b) => b.total > 0 || b.status !== "pending") && !flag("reset")) {
    throw new Error(`awards not clean (${JSON.stringify(before)}) — add --reset to wipe them first`);
  }
  for (const id of [AWARD_A, AWARD_B]) await resetAward(id);
  dirty = true;
  await warmUp();

  // 1. listeners
  const tConn = performance.now();
  for (let i = 0; i < TALLY_LISTENERS; i++) openListener("stage");
  for (let i = 0; i < LISTENERS; i++) {
    openListener("mobile");
    if (i % 20 === 19) await sleep(100); // phones arrive over a few seconds, not in one tick
  }
  const connWait = await waitFor(() => connectedNow >= LISTENERS + TALLY_LISTENERS, 30_000);
  check(connWait !== null, `${LISTENERS + TALLY_LISTENERS} Ably connections up (${((performance.now() - tConn) / 1000).toFixed(1)} s)`);
  await sleep(1_000); // let the channel attaches settle

  // 2. award A — all phones at once
  say(`\n## A. ${DEVICES} phones vote at the same instant (award ${AWARD_A})`);
  o = await act({ action: "open", award_id: AWARD_A, seconds: 0 });
  const openVersion = o.state.version;
  const heard = await waitFor(() => (eventArrivals.get(openVersion) ?? 0) >= LISTENERS + TALLY_LISTENERS, 10_000);
  check(heard !== null, `"award open" reached all ${LISTENERS + TALLY_LISTENERS} listeners (${eventArrivals.get(openVersion) ?? 0} heard it${heard !== null ? `, ${heard.toFixed(0)} ms` : ""})`);

  const votes: Vote[] = Array.from({ length: DEVICES }, () => ({
    device: randomUUID(),
    request: randomUUID(),
    nominee: 1 + Math.floor(Math.random() * 29),
  }));
  const expectedA = new Map<number, number>();
  for (const v of votes) expectedA.set(v.nominee, (expectedA.get(v.nominee) ?? 0) + 1);

  const tA = performance.now();
  const first = await Promise.all([
    ...votes.map((v) => sendVote(AWARD_A, v)),
    // 20 phones whose first send "times out" and is resent while the first is still in flight
    ...votes.slice(0, DOUBLE_SEND).map((v) => sendVote(AWARD_A, v)),
  ]);
  const wallA = performance.now() - tA;
  const byResult = (xs: VoteOut[]) => Object.fromEntries([...new Set(xs.map((x) => x.result))].map((r) => [r, xs.filter((x) => x.result === r).length]));
  say(`results ${JSON.stringify(byResult(first))} · all answered in ${wallA.toFixed(0)} ms`);
  say(`POST /api/vote (concurrent) ${stats(first.map((x) => x.ms))}`);
  check(first.every((x) => x.result === "counted"), `every phone (and every in-flight double send) got "counted"`);

  const stageA = await waitFor(() => latestTally?.award_id === AWARD_A && latestTally.total === DEVICES, 15_000);
  check(stageA !== null && stageA <= 2_000, `stage (Ably) shows total ${DEVICES} within 2 s of the last answer${stageA !== null ? ` (+${stageA.toFixed(0)} ms)` : ` — has ${latestTally?.total ?? "nothing"}`}`);

  // Replays: same request again → counted (not double), new request from the same phone → already_voted
  const replays = await Promise.all([
    ...votes.map((v) => sendVote(AWARD_A, v)),
    ...votes.map((v) => sendVote(AWARD_A, { ...v, request: randomUUID(), nominee: 1 + ((v.nominee + 5) % 29) })),
  ]);
  const same = replays.slice(0, DEVICES);
  const second = replays.slice(DEVICES);
  say(`replays ${JSON.stringify(byResult(same))} · second ballots ${JSON.stringify(byResult(second))}`);
  say(`POST /api/vote (replay burst ×${replays.length}) ${stats(replays.map((x) => x.ms))}`);
  check(same.every((x) => x.result === "counted"), `resending the same request answers "counted" (phone shows thank-you)`);
  check(second.every((x) => x.result === "already_voted"), `a second ballot from the same phone → "already_voted"`);

  o = await overview();
  const dbA = o.tallies.find((t) => t.award_id === AWARD_A)!;
  check(dbA.total === DEVICES, `DB total for award ${AWARD_A} = ${DEVICES} (got ${dbA.total}) — nothing lost, nothing doubled`);
  check(dbA.verified, `verify_tallies(${AWARD_A}) = true (ballots = sum of tallies)`);
  compareCounts(`award ${AWARD_A} DB`, expectedA, countsOf(dbA));
  await sleep(500);
  compareCounts(`award ${AWARD_A} stage (Ably)`, expectedA, countsOf(latestTally));
  const snapA = await stageSnapshot();
  check(snapA?.total === dbA.total && snapA.seq === dbA.seq, `stage snapshot = DB (total ${snapA?.total}, seq ${snapA?.seq} vs ${dbA.seq})`);
  check(latestTally?.seq === dbA.seq, `newest seq on the stage = DB seq (${latestTally?.seq} vs ${dbA.seq}) — no stale message won`);

  // 3. award B — burst inside one second
  say(`\n## B. ${BURST} votes inside 1 second (award ${AWARD_B})`);
  await act({ action: "close", award_id: AWARD_A });
  await act({ action: "open", award_id: AWARD_B, seconds: 0 });
  await waitFor(() => latestTally?.award_id === AWARD_B, 5_000);
  const tallyBefore = tallyMessages;
  const burst: Vote[] = Array.from({ length: BURST }, (_, i) => ({ device: randomUUID(), request: randomUUID(), nominee: (i % 29) + 1 }));
  const expectedB = new Map<number, number>();
  for (const v of burst) expectedB.set(v.nominee, (expectedB.get(v.nominee) ?? 0) + 1);
  const tB = performance.now();
  const burstOut = await Promise.all(
    burst.map(async (v, i) => {
      await sleep((i * 1000) / BURST);
      return sendVote(AWARD_B, v);
    }),
  );
  const lastAnswer = performance.now();
  say(`results ${JSON.stringify(byResult(burstOut))} · sent over 1 s, all answered after ${(lastAnswer - tB).toFixed(0)} ms`);
  say(`POST /api/vote (burst) ${stats(burstOut.map((x) => x.ms))}`);
  check(burstOut.every((x) => x.result === "counted"), `every burst vote "counted"`);
  const viaAbly = await waitFor(() => latestTally?.award_id === AWARD_B && latestTally.total === BURST, 15_000);
  await sleep(2_000); // late, older messages still land after the newest one
  check(viaAbly !== null && viaAbly <= 2_000, `newest Ably message = DB within 2 s after the last answer${viaAbly !== null ? ` (${viaAbly.toFixed(0)} ms)` : ` — has ${latestTally?.total ?? "nothing"}`}`);
  const gotMsgs = (tallyMessages - tallyBefore) / Math.max(1, TALLY_LISTENERS);
  say(`tally messages per stage listener during burst: ${gotMsgs.toFixed(0)} for ${BURST} votes (the server sends only the newest snapshot per award — fewer messages, same final total)`);
  if (viaAbly !== null) {
    check(true, `stage has the true total ${BURST} over Ably ${viaAbly.toFixed(0)} ms after the last answer (< 15 s)`);
  } else {
    // What the real stage does every 15 s
    const snap = await stageSnapshot();
    check(snap?.total === BURST, `Ably fell short (${latestTally?.total}) — the 15 s snapshot resync has the true total ${snap?.total}`);
  }
  o = await overview();
  const dbB = o.tallies.find((t) => t.award_id === AWARD_B)!;
  check(dbB.total === BURST && dbB.verified, `DB total for award ${AWARD_B} = ${BURST} (got ${dbB.total}) · verify_tallies = ${dbB.verified}`);
  compareCounts(`award ${AWARD_B} DB`, expectedB, countsOf(dbB));

  // 4. shared IP
  say(`\n## Connections + shared IP`);
  check(connectedMax < 200, `max simultaneous Ably connections from this test = ${connectedMax} (< 200 free ceiling; + stage + MC in the real room)`);
  if (SERVER_LOG) {
    const lines = (await readFile(SERVER_LOG, "utf8")).split("\n").slice(logStart);
    const failed = lines.filter((l) => /\[ably\] publish .* failed/.test(l)).length;
    const refused = lines.filter((l) => /\[ably\] publish .* rate_limited/.test(l)).length;
    say(`server log: ${refused} rate refusals (42913, retried with the newest snapshot)`);
    check(failed === 0, `server log: ${failed} Ably publish errors other than rate refusals`);
  }
  say(`client network errors (no answer at all — never reached the app): ${networkErrors.size ? [...networkErrors].map(([c, n]) => `${c}×${n}`).join(", ") : "none"} · vote resends (same request_id) ${voteResends} · MC re-presses ${adminRetries.length ? adminRetries.join(", ") : "none"}`);
  check(fiveXX() === 0, `no 5xx answer from the server (${fiveXX()})`);
  const r429 = statusCounts.get(429) ?? 0;
  check(r429 === 0, `no request refused with 429 although every request came from one IP (${[...statusCounts].map(([s, n]) => `${s}×${n}`).join(", ")})`);
  const dropped = listeners.filter((l) => !l.connected).length;
  check(dropped === 0, `no listener dropped during the test (${dropped} disconnected)`);

  // 5. clean up (also runs from finally on any error, so no award is left open)
  await cleanup();

  say(`\n${problems.length ? `FAILED ${problems.length}` : "ALL PASS"}`);
  await mkdir(OUT, { recursive: true });
  const stamp = started.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const target = isLocal ? "local" : new URL(origin).hostname.split(".")[0];
  await writeFile(`${OUT}/load-${target}-${stamp}.md`, "```\n" + log.join("\n") + "\n```\n");
  say(`written ${OUT}/load-${target}-${stamp}.md`);
  process.exitCode = problems.length ? 1 : 0;
}

// dirty stays true until a cleanup has really finished, so a failed attempt is tried again
// (a 503 during reset left the awards dirty and the finally-pass skipped them)
let dirty = false;
async function cleanup() {
  if (!dirty) return;
  for (let attempt = 1; ; attempt++) {
    try {
      if (flag("keep")) {
        // Keep the votes for inspection, but never leave an award open
        const o = await overview();
        for (const a of o.state.awards) if (a.status === "open") await act({ action: "close", award_id: a.id });
        say(`--keep: awards left with their votes (closed)`);
      } else {
        for (const id of [AWARD_A, AWARD_B]) await resetAward(id);
        await act({ action: "lobby" });
        say(`awards ${AWARD_A},${AWARD_B} reset to pending · stage back to lobby`);
      }
      dirty = false;
      return;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (attempt >= 8) {
        console.error(`CLEANUP FAILED after ${attempt} tries — reset awards ${AWARD_A},${AWARD_B} by hand: ${msg}`);
        process.exitCode = 2;
        return;
      }
      console.error(`cleanup try ${attempt} failed (${msg}) — trying again`);
      await sleep(2_000 * attempt);
    }
  }
}

main()
  .catch(async (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 2;
  })
  .finally(async () => {
    await cleanup();
    for (const l of listeners) l.client.close();
    await dispatcher.close().catch(() => undefined);
    process.exit(process.exitCode ?? 0);
  });
