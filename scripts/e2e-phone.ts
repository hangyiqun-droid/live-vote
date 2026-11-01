// One phone page stays open through all 5 awards and is never reloaded or rescanned.
// The phone actually votes (the older e2e never did) and is put through what real phones do:
// screen off 60 s (page frozen + network gone), a socket that dies silently while the client still
// says "connected", the wake-up fetch failing, offline/online, the MC changing award during the
// confirm sheet, and Ably blocked outright (polling alone). Usage (dev branch only):
//   pnpm build && pnpm start -p 3155 &  then  pnpm e2e:phone [baseUrl]
import { config } from "dotenv";
import { chromium, type BrowserContext, type CDPSession, type Page, type WebSocketRoute } from "playwright-core";
import { seedAwards } from "../src/data/awards";

config({ path: ".env.local", quiet: true });

const base = (process.argv[2] ?? "http://localhost:3155").replace(/\/$/, "") + (process.env.NEXT_PUBLIC_BASE_PATH ?? "");
const PASS = process.env.ADMIN_PASSCODE ?? "";
const SCREEN_OFF_MS = Number(process.env.E2E_SCREEN_OFF_MS ?? 60_000);
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const FOLLOW_MS = 2_000; // brief: the phone follows the MC within 2 s while the screen is on
const ZOMBIE_MS = 7_000; // silent socket: nothing can tell, so the 4 s check (±20%, up to 4.8 s) + a round trip

const log: string[] = [];
const problems: string[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const check = (ok: boolean, what: string) => {
  log.push(`${ok ? "PASS" : "FAIL"} ${what}`);
  if (!ok) problems.push(what);
};

let cookie = "";
let since = 0; // clock starts when the MC presses, not when the press is answered
async function login() {
  const r = await fetch(`${base}/api/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ passcode: PASS }),
  });
  cookie = (r.headers.getSetCookie()[0] ?? "").split(";")[0];
  if (!r.ok || !cookie) throw new Error(`admin login failed: ${r.status}`);
}

async function mc(body: Record<string, unknown>) {
  since = Date.now();
  const r = await fetch(`${base}/api/admin/action`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
  return r.status;
}

const open = (id: number, seconds = 0) => mc({ action: "open", award_id: id, seconds });
const close = (id: number) => mc({ action: "close", award_id: id });
const reveal = (id: number) => mc({ action: "reveal", award_id: id });
const show = (id: number) => mc({ action: "show", award_id: id });

async function cleanSlate() {
  for (let id = 1; id <= 5; id++) {
    await close(id);
    await mc({ action: "unreveal", award_id: id });
    const o = await (await fetch(`${base}/api/admin/overview`, { headers: { cookie } })).json();
    await mc({ action: "reset", award_id: id, confirm: o.state.awards[id - 1].title });
    await mc({ action: "rename", award_id: id, title: seedAwards[id - 1].title, subtitle: "" });
  }
  for (const b of [{ action: "hide", on: false }, { action: "hall", on: false }, { action: "qr_fallback", on: false }, { action: "lobby" }]) await mc(b);
}

// How long until the phone shows `text` (null = never within the limit)
async function follow(page: Page, text: string, timeout = 8_000): Promise<number | null> {
  try {
    await page.getByText(text, { exact: false }).first().waitFor({ timeout });
    return Date.now() - since;
  } catch {
    return null;
  }
}

async function expectFollow(page: Page, text: string, limit: number, what: string, timeout = 8_000) {
  const ms = await follow(page, text, timeout);
  check(ms !== null && ms <= limit, `${what}: ${ms === null ? `not within ${timeout} ms` : `${ms} ms`} (limit ${limit})`);
}

const titleOf = (id: number) => seedAwards[id - 1].title;

// The award's title alone is not enough: "รางวัลถัดไป" names it before voting opens
async function expectGrid(page: Page, id: number, limit: number, what: string, timeout = 8_000) {
  try {
    await page.locator("h1", { hasText: titleOf(id) }).waitFor({ timeout });
    await page.getByRole("button", { name: /มะลิ/ }).first().waitFor({ timeout });
    const ms = Date.now() - since;
    check(ms <= limit, `${what}: ${ms} ms (limit ${limit})`);
  } catch {
    check(false, `${what}: not within ${timeout} ms`);
  }
}

async function voteFor(page: Page, nickname: RegExp) {
  await page.getByRole("button", { name: nickname }).first().click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: "ยืนยันโหวต" }).click();
  await page.getByText("ส่งแล้ว! ดูคะแนนบนจอใหญ่ได้เลย").waitFor({ timeout: 8_000 });
}

// Total of the award on screen
async function tally(): Promise<number> {
  const k = encodeURIComponent(process.env.STAGE_KEY ?? "");
  const j = await (await fetch(`${base}/api/stage/snapshot?k=${k}`)).json();
  return j.tally?.total ?? -1;
}

// Page frozen like a locked phone: timers stop, the socket is gone, the page wakes where it was
async function screenOff(cdp: CDPSession, ctx: BrowserContext, ms: number, meanwhile: () => Promise<void>) {
  await ctx.setOffline(true);
  await cdp.send("Page.setWebLifecycleState", { state: "frozen" });
  const t0 = Date.now();
  await meanwhile();
  await sleep(Math.max(0, ms - (Date.now() - t0)));
}

async function screenOn(cdp: CDPSession, ctx: BrowserContext, page: Page) {
  since = Date.now();
  await ctx.setOffline(false);
  await cdp.send("Page.setWebLifecycleState", { state: "active" });
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
}

async function main() {
  await login();
  await cleanSlate();
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });

  // ---- The phone that stays open: every socket passes through here so tests can kill it ----
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: "th-TH" });
  const page = await ctx.newPage();
  const errors: string[] = [];
  let tolerate = false;
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() !== "error" || tolerate) return;
    errors.push(m.text());
  });
  const cdp = await ctx.newCDPSession(page);

  let silent = false; // zombie: frames stop flowing, nobody tells the client
  let live: WebSocketRoute | null = null;
  await page.routeWebSocket(/ably/, (ws) => {
    const server = ws.connectToServer();
    live = ws;
    ws.onMessage((m) => {
      if (!silent) server.send(m);
    });
    server.onMessage((m) => {
      if (!silent) ws.send(m);
    });
  });

  await page.goto(base);
  await page.evaluate(() => ((window as unknown as { __once: number }).__once = 1));
  await expectFollow(page, "รางวัลนี้ยังไม่เปิดโหวต", 8_000, "lobby message");

  // ---- Award 1: plain walk, the phone votes for real ----
  await sleep(1_500); // let the socket settle
  await show(1);
  await open(1);
  await expectGrid(page, 1, FOLLOW_MS, "award 1: grid opens by itself");
  await voteFor(page, /มะลิ/);
  await close(1);
  await expectFollow(page, "ปิดโหวตรางวัลนี้แล้ว", FOLLOW_MS, "award 1: thank-you → closed by itself");
  await reveal(1);
  await expectFollow(page, "ประกาศผลแล้ว", FOLLOW_MS, "award 1: closed → revealed by itself");

  // ---- Award 2: socket dies silently; the client still says "connected" ----
  await show(2);
  await open(2);
  await expectGrid(page, 2, FOLLOW_MS, "award 2: grid opens by itself");
  await voteFor(page, /มะลิ/);
  silent = true;
  await close(2);
  await expectFollow(page, "ปิดโหวตรางวัลนี้แล้ว", ZOMBIE_MS, "award 2: zombie socket → closed still arrives", 40_000);
  await reveal(2);
  await expectFollow(page, "ประกาศผลแล้ว", ZOMBIE_MS, "award 2: zombie socket → revealed still arrives", 40_000);
  silent = false;
  (live as WebSocketRoute | null)?.close({ code: 1006 + 2000, reason: "test" }).catch(() => undefined);
  await sleep(3_000);

  // ---- Award 3: screen off 60 s; the MC moves on; the wake-up fetch fails once ----
  await show(3);
  await open(3);
  await expectGrid(page, 3, 6_000, "award 3: grid opens by itself");
  await voteFor(page, /มะลิ/);
  tolerate = true;
  await screenOff(cdp, ctx, SCREEN_OFF_MS, async () => {
    await close(3);
    await reveal(3);
    await show(4);
    await open(4);
  });
  let failOnce = true;
  await page.route("**/api/state", async (route) => {
    if (failOnce) {
      failOnce = false;
      await route.abort("connectionreset");
    } else await route.continue();
  });
  await screenOn(cdp, ctx, page);
  await expectGrid(page, 4, 4_000, `award 4: back from ${SCREEN_OFF_MS / 1000} s screen off (first fetch fails) → grid`);
  await page.unroute("**/api/state");
  tolerate = false;
  await sleep(4_000);

  // ---- Award 4: MC changes award during the confirm sheet: never a vote on the wrong award ----
  const before4 = await tally();
  await page.getByRole("button", { name: /มะลิ/ }).first().click();
  await page.getByRole("dialog").waitFor();
  await close(4);
  await expectFollow(page, "ปิดโหวตรางวัลนี้แล้ว", FOLLOW_MS, "award 4: confirm sheet → closed, sheet gone");
  check((await page.getByRole("dialog").count()) === 0, "award 4: confirm sheet closes when voting stops");
  await reveal(4);
  await show(5);
  await open(5);
  await expectGrid(page, 5, FOLLOW_MS, "award 5: grid opens by itself");
  check((await page.getByRole("dialog").count()) === 0, "award 5: the old pick does not come back as a confirm sheet");
  check((await page.getByRole("button", { name: /มะลิ/ }).first().getAttribute("aria-pressed")) === "false", "award 5: no tile pre-selected from award 4");

  // ---- Award 5: offline → online; then a device that already voted ----
  await voteFor(page, /มะลิ/);
  tolerate = true;
  await ctx.setOffline(true);
  await sleep(1_000);
  await close(5);
  await sleep(1_000);
  since = Date.now();
  await ctx.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expectFollow(page, "ปิดโหวตรางวัลนี้แล้ว", 2_500, "award 5: offline → online catches up");
  tolerate = false;
  await mc({ action: "reopen", award_id: 5 });
  await expectFollow(page, "ส่งแล้ว!", FOLLOW_MS, "award 5 reopened: this device already voted → thank-you, not the grid");

  check((await page.evaluate(() => (window as unknown as { __once?: number }).__once)) === 1, "page was never reloaded through all 5 awards");
  check(errors.length === 0, `no page errors on the open phone${errors.length ? `: ${errors.slice(0, 3).join(" | ")}` : ""}`);
  await ctx.close();

  await close(5);
  check((await tally()) === 1, "award 5: exactly the one vote cast");
  await show(4);
  check((await tally()) === before4, "award 4: the abandoned confirm sheet added nothing");

  // ---- Fallback alone: Ably refused outright, the MC still moves the phone ----
  await cleanSlate();
  await sleep(1_000);
  const octx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "th-TH" });
  const lonely = await octx.newPage();
  await lonely.route(/ably\.(net|io|com)/, (r) => r.abort());
  await lonely.routeWebSocket(/ably/, (ws) => void ws.close());
  await lonely.route("**/api/realtime/token", (r) => r.abort());
  await lonely.goto(base);
  await lonely.evaluate(() => ((window as unknown as { __once: number }).__once = 1));
  await expectFollow(lonely, "รางวัลนี้ยังไม่เปิดโหวต", 8_000, "no Ably: lobby message");
  const pollLimit = 6_000; // poll every ≤ 5 s + one round trip
  await show(1);
  await open(1);
  await expectGrid(lonely, 1, pollLimit, "no Ably: grid opens from polling alone", 15_000);
  await voteFor(lonely, /มะลิ/);
  await close(1);
  await expectFollow(lonely, "ปิดโหวตรางวัลนี้แล้ว", pollLimit, "no Ably: closed from polling alone", 15_000);
  await reveal(1);
  await expectFollow(lonely, "ประกาศผลแล้ว", pollLimit, "no Ably: revealed from polling alone", 15_000);
  await show(2);
  await open(2);
  await expectGrid(lonely, 2, pollLimit, "no Ably: next award from polling alone", 15_000);
  check((await lonely.evaluate(() => (window as unknown as { __once?: number }).__once)) === 1, "no Ably: page never reloaded");
  await octx.close();

  await browser.close();
  await cleanSlate();
  console.log(log.join("\n"));
  console.log(problems.length ? `PROBLEMS (${problems.length}):\n${problems.join("\n")}` : "problems: none");
  if (problems.length) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  console.log(log.join("\n"));
  process.exit(1);
});
