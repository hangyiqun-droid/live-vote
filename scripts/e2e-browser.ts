// Browser checks with headless system Chrome (fresh temp profile — never a personal profile).
// Phone emulation is NOT a real device; QA still repeats on real iOS Safari + Android Chrome.
// Usage: pnpm award close 1; pnpm award reset 1; pnpm award open 1; pnpm e2e [baseUrl]
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { config } from "dotenv";
import { chromium, type Browser, type Page } from "playwright-core";

config({ path: ".env.local", quiet: true });

const base = (process.argv[2] ?? "http://localhost:3155").replace(/\/$/, "") + (process.env.NEXT_PUBLIC_BASE_PATH ?? "");
const K = process.env.STAGE_KEY ?? "";
const OUT = process.env.E2E_OUT ?? ".e2e-out/browser";
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const problems: string[] = [];
// Network errors we cause on purpose (dropped reply, stage offline) are not app errors
let expectNetErrors = false;
const notFound = new Set<string>();

function watch(page: Page, label: string) {
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    if (expectNetErrors && /ERR_(INTERNET_DISCONNECTED|CONNECTION_RESET)|WebSocket connection/.test(m.text())) return;
    problems.push(`${label} console: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`${label} pageerror: ${e.message}`));
  page.on("response", (r) => r.status() === 404 && notFound.add(r.url()));
}

async function dbTotal(): Promise<{ total: number; counts: Map<number, number> }> {
  const j = await (await fetch(`${base}/api/stage/snapshot?k=${encodeURIComponent(K)}`)).json();
  return { total: j.tally.total, counts: new Map(j.tally.counts) };
}

// All 29 tiles on one portrait screen, no vertical scroll, big enough to tap, circles actually round
async function tileCheck(browser: Browser, name: string, viewport: { width: number; height: number }, dpr: number) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: dpr, isMobile: true, hasTouch: true, locale: "th-TH" });
  const page = await ctx.newPage();
  watch(page, name);
  await page.goto(base);
  await page.getByRole("button", { name: /มะลิ/ }).waitFor();
  await page.screenshot({ path: `${OUT}/vote-${viewport.width}x${viewport.height}.jpg`, quality: 78 });
  const fit = await page.evaluate(() => ({
    scroll: document.documentElement.scrollHeight,
    inner: window.innerHeight,
    wide: document.documentElement.scrollWidth,
    vw: window.innerWidth,
    bottom: Math.max(...[...document.querySelectorAll("ul button")].map((b) => b.getBoundingClientRect().bottom)),
    tap: Math.min(...[...document.querySelectorAll("ul button")].map((b) => Math.min(b.clientWidth, b.clientHeight))),
    clipped: [...document.querySelectorAll("ul button > span:last-child")].filter((e) => e.getBoundingClientRect().height < 12).length,
  }));
  const circles = await page.$$eval("ul button > span:first-child > span", (els) =>
    els.map((e) => ({ w: e.getBoundingClientRect().width, h: e.getBoundingClientRect().height })),
  );
  const minD = Math.min(...circles.map((c) => Math.min(c.w, c.h)));
  const round = circles.every((c) => Math.abs(c.w - c.h) < 1);
  const result = `${name} ${viewport.width}x${viewport.height}@${dpr}: scrollHeight ${fit.scroll} ≤ innerHeight ${fit.inner} · last tile bottom ${fit.bottom.toFixed(0)} · ${circles.length} avatars · smallest ${minD.toFixed(0)}px${round ? "" : " (NOT round)"} · smallest tap ${fit.tap}px`;
  const small = viewport.width >= 360 && minD < 40;
  if (fit.scroll > fit.inner || fit.wide > fit.vw || fit.bottom > fit.inner || fit.tap < 44 || fit.clipped || !round || small || circles.length !== 29) {
    problems.push(`tile check failed: ${result}`);
  }
  await ctx.close();
  return result;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const log: string[] = [];

  // 1. One-screen grid from the smallest supported phone to the largest
  log.push(await tileCheck(browser, "small", { width: 320, height: 568 }, 2));
  log.push(await tileCheck(browser, "android-small", { width: 360, height: 640 }, 3));
  log.push(await tileCheck(browser, "iphone", { width: 390, height: 844 }, 3));
  log.push(await tileCheck(browser, "android", { width: 412, height: 915 }, 2.625));
  log.push(await tileCheck(browser, "iphone-max", { width: 430, height: 932 }, 3));

  // 2. Lost reply then retry → counted exactly once
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  watch(page, "vote");
  await page.goto(base);
  const before = await dbTotal();
  await page.getByRole("button", { name: /ฝ้าย \(วรรณพร\)/ }).click();
  const sheet = page.getByRole("dialog");
  await sheet.waitFor();
  const sheetText = (await sheet.innerText()).replace(/\s+/g, " ");
  if (!sheetText.includes("วรรณพร") || !sheetText.includes("RUBY")) problems.push(`sheet text: ${sheetText}`);
  await page.screenshot({ path: `${OUT}/vote-confirm.jpg`, quality: 70 });

  expectNetErrors = true;
  let dropped = 0;
  await page.route("**/api/vote", async (route) => {
    if (dropped === 0) {
      dropped++;
      await route.fetch(); // the vote reaches the server and is stored…
      await route.abort("connectionreset"); // …but the phone never hears back
      return;
    }
    await route.continue();
  });
  await sheet.getByRole("button", { name: "ยืนยันโหวต" }).click();
  await page.getByRole("alert").filter({ hasText: "ส่งไม่สำเร็จ" }).waitFor();
  await page.screenshot({ path: `${OUT}/vote-retry-banner.jpg`, quality: 70 });
  const mid = await dbTotal();
  await sheet.getByRole("button", { name: "ลองใหม่" }).click();
  await page.getByText("ส่งแล้ว! ดูคะแนนบนจอใหญ่ได้เลย").waitFor();
  await page.screenshot({ path: `${OUT}/vote-success.jpg`, quality: 70 });
  expectNetErrors = false;
  const after = await dbTotal();
  const delta25 = (after.counts.get(25) ?? 0) - (before.counts.get(25) ?? 0);
  log.push(`lost reply + retry: stored on 1st try (total ${before.total}→${mid.total}), retry answered counted, total now ${after.total} · ฝ้าย RUBY +${delta25}`);
  if (delta25 !== 1 || after.total !== before.total + 1) problems.push("retry counted more than once");

  await page.reload();
  await page.getByText("คุณโหวต").waitFor();
  log.push("reload after voting → still shows 'คุณโหวต ฝ้าย'");
  await ctx.close();

  // 3. Stage: lose the network for 30 s while votes come in, then reconnect
  const sctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const stage = await sctx.newPage();
  watch(stage, "stage");
  await stage.goto(`${base}/stage?k=${encodeURIComponent(K)}`);
  await stage.getByRole("button", { name: "เริ่มงาน" }).click(); // start gate: sound + full screen
  await stage.locator("[data-stage-total]").waitFor();
  // The total in the right panel (the digits roll, so read the value the stage is showing/rolling to)
  const shown = async () => Number(await stage.locator("[data-stage-total]").getAttribute("data-stage-total"));
  const totalIs = (n: number) => document.querySelector("[data-stage-total]")?.getAttribute("data-stage-total") === String(n);
  // Live update while connected
  const s0 = await shown();
  const tVote = Date.now();
  await castVotes(1);
  await stage.waitForFunction(totalIs, s0 + 1);
  log.push(`stage live update while connected: ${Date.now() - tVote} ms (HTTP vote → number on stage DOM)`);
  await stage.screenshot({ path: `${OUT}/stage-live.jpg`, quality: 70 });

  expectNetErrors = true;
  await sctx.setOffline(true);
  await castVotes(3);
  await stage.waitForTimeout(30_000);
  const banner = await stage.getByRole("status").filter({ hasText: /เชื่อมต่อ/ }).innerText().catch(() => "(no banner)");
  await stage.screenshot({ path: `${OUT}/stage-offline.jpg`, quality: 70 });
  const frozen = await shown();
  await sctx.setOffline(false);
  const tBack = Date.now();
  const want = (await dbTotal()).total;
  await stage.waitForFunction(totalIs, want, { timeout: 20_000 });
  log.push(`stage offline 30 s: banner "${banner}" · showed ${frozen} while DB moved on · back online → ${want} (= DB) in ${Date.now() - tBack} ms`);
  expectNetErrors = false;
  await sctx.close();

  // 4. Stage without / with a wrong key
  const bctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const bad = await bctx.newPage();
  await bad.goto(`${base}/stage`);
  await bad.getByText("ลิงก์จอใหญ่ไม่ถูกต้อง").waitFor();
  await bad.goto(`${base}/stage?k=wrong`);
  await bad.getByText("ลิงก์จอใหญ่ไม่ถูกต้อง").waitFor();
  log.push("stage without key / wrong key → 'ลิงก์จอใหญ่ไม่ถูกต้อง ขอลิงก์จากผู้ดูแลระบบ', no counts");
  await bctx.close();

  await browser.close();
  console.log(log.join("\n"));
  console.log(notFound.size ? `404s:\n${[...notFound].join("\n")}` : "404s: none");
  console.log(problems.length ? `PROBLEMS:\n${problems.join("\n")}` : "problems: none");
  if (problems.length || notFound.size) process.exit(1);
}

async function castVotes(n: number) {
  const state = await (await fetch(`${base}/api/state`)).json();
  const award = state.awards.find((a: { status: string }) => a.status === "open");
  for (let i = 0; i < n; i++) {
    await fetch(`${base}/api/vote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ award_id: award.id, nominee_id: 1 + i, request_id: randomUUID(), device_id: randomUUID() }),
    });
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
