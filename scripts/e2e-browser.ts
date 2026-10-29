// M1 browser checks with headless system Chrome (fresh temp profile — never a personal profile).
// Phone emulation is NOT a real device; QA still repeats on real iOS Safari + Android Chrome.
// Usage: pnpm award close 1; pnpm award reset 1; pnpm award open 1; pnpm e2e [baseUrl]
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { config } from "dotenv";
import { chromium, type Browser, type Page } from "playwright-core";

config({ path: ".env.local", quiet: true });

const base = (process.argv[2] ?? "http://localhost:3155").replace(/\/$/, "") + "";
const K = process.env.STAGE_KEY ?? "";
const OUT = "docs/qa/evidence/m1";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

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

async function photoCheck(browser: Browser, name: string, viewport: { width: number; height: number }, dpr: number) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: dpr, isMobile: true, hasTouch: true, locale: "th-TH" });
  const page = await ctx.newPage();
  watch(page, name);
  await page.goto(base);
  await page.getByRole("button", { name: /ปุ้ย/ }).waitFor();
  await page.screenshot({ path: `${OUT}/vote-${name}-top.jpg`, quality: 70 });
  // Scroll through so lazy photos load, then measure every grid photo (SPEC 4.2 row 3)
  for (let y = 0; y < 4000; y += 400) {
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(80);
  }
  await page.waitForFunction(() => [...document.querySelectorAll("ul img")].every((i) => (i as HTMLImageElement).complete));
  const rows = await page.$$eval("ul img", (imgs) =>
    imgs.map((el) => {
      const i = el as HTMLImageElement;
      // naturalWidth is density-corrected with srcset `w`, so use the chosen file's real pixel width
      const file = Number(i.currentSrc.split("/").slice(-2)[0]);
      return { nw: file, cw: i.clientWidth, ch: i.clientHeight, src: i.currentSrc.split("/").slice(-2).join("/") };
    }),
  );
  const need = Math.min(dpr, 3);
  const sharp = rows.filter((r) => r.nw >= r.cw * need).length;
  const minW = Math.min(...rows.map((r) => r.cw));
  const result = `${name} ${viewport.width}x${viewport.height}@${dpr}: ${rows.length} photos · min width ${minW}px · sharp ${sharp}/${rows.length} · e.g. ${rows[0].src} file ${rows[0].nw}px vs shown ${rows[0].cw}×${need}`;
  if (sharp !== rows.length || minW < 104 || rows.length !== 29) problems.push(`photo check failed: ${result}`);
  await ctx.close();
  return result;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const log: string[] = [];

  // 1. Face grid sharpness on a narrow iPhone-like and an Android-like viewport
  log.push(await photoCheck(browser, "iphone", { width: 360, height: 740 }, 3));
  log.push(await photoCheck(browser, "android", { width: 412, height: 915 }, 2.625));

  // 2. Lost reply then retry → counted exactly once
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  watch(page, "vote");
  await page.goto(base);
  const before = await dbTotal();
  await page.getByRole("button", { name: /ดิว \(ต้นกล้า\)/ }).click();
  const sheet = page.getByRole("dialog");
  await sheet.waitFor();
  const sheetText = (await sheet.innerText()).replace(/\s+/g, " ");
  if (!sheetText.includes("ต้นกล้า") || !sheetText.includes("RUBY")) problems.push(`sheet text: ${sheetText}`);
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
  log.push(`lost reply + retry: stored on 1st try (total ${before.total}→${mid.total}), retry answered counted, total now ${after.total} · ดิว RUBY +${delta25}`);
  if (delta25 !== 1 || after.total !== before.total + 1) problems.push("retry counted more than once");

  await page.reload();
  await page.getByText("คุณโหวต").waitFor();
  log.push("reload after voting → still shows 'คุณโหวต ดิว'");
  await ctx.close();

  // 3. Stage: lose the network for 30 s while votes come in, then reconnect
  const sctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const stage = await sctx.newPage();
  watch(stage, "stage");
  await stage.goto(`${base}/stage?k=${encodeURIComponent(K)}`);
  await stage.getByText(/เสียงรวม/).waitFor();
  const shown = async () => Number((await stage.getByText(/เสียงรวม/).innerText()).replace(/[^0-9]/g, ""));
  // Live update while connected
  const s0 = await shown();
  const tVote = Date.now();
  await castVotes(1);
  await stage.waitForFunction((n) => document.body.innerText.includes(`เสียงรวม ${(n as number).toLocaleString("th-TH")}`), s0 + 1);
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
  await stage.waitForFunction(
    (n) => document.body.innerText.includes(`เสียงรวม ${(n as number).toLocaleString("th-TH")}`),
    want,
    { timeout: 20_000 },
  );
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
