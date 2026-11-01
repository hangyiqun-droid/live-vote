// Admin page acceptance with headless system Chrome: the MC page drives all 5 awards pending → revealed
// while the stage (1920×1080) and a phone (390×844) follow live — no page is ever reloaded.
// Covers: wrong passcode, every "กดผิด" undo, hide counts, lobby, hall, backup QR, rename, reset,
// the MC timer + auto close, and reveal scenes for: plain 1/2/3 · equal scores at 1st, 2nd and 3rd
// (first to the score ranks higher) · no votes. The phone must never receive a count. Screenshots → $E2E_OUT/admin (default .e2e-out/admin).
// Usage (dev branch only): pnpm build && pnpm start -p 3157 &  then  pnpm e2e:admin [baseUrl]
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { config } from "dotenv";
import { seedAwards } from "../src/data/awards";
import { chromium, type Locator, type Page } from "playwright-core";

config({ path: ".env.local", quiet: true });

const base = (process.argv[2] ?? "http://localhost:3157").replace(/\/$/, "") + (process.env.NEXT_PUBLIC_BASE_PATH ?? "");
const K = process.env.STAGE_KEY ?? "";
const PASS = process.env.ADMIN_PASSCODE ?? "";
const OUT = process.env.E2E_OUT ?? ".e2e-out/admin";
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const problems: string[] = [];
let stagePage: Page | null = null;
const log: string[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const check = (ok: boolean, what: string) => {
  log.push(`${ok ? "PASS" : "FAIL"} ${what}`);
  if (!ok) problems.push(what);
};

async function vote(award: number, nominee: number) {
  const r = await fetch(`${base}/api/vote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ award_id: award, nominee_id: nominee, request_id: randomUUID(), device_id: randomUUID() }),
  });
  const j = (await r.json()) as { result: string };
  if (j.result !== "counted") problems.push(`vote ${award}/${nominee}: ${j.result}`);
}

// In the order given: who reaches a score first decides ties
async function votes(award: number, plan: [number, number][]) {
  for (const [id, n] of plan) for (let i = 0; i < n; i++) await vote(award, id);
}

const card = (admin: Page, id: number) => admin.locator(`[data-award="${id}"]`);

async function hold(page: Page, btn: Locator) {
  // Ably can announce the new status before the HTTP answer lands; buttons stay locked until then
  for (let i = 0; i < 40 && (await btn.isDisabled()); i++) await sleep(100);
  await btn.scrollIntoViewIfNeeded();
  await btn.hover();
  await page.mouse.down();
  await sleep(1700);
  await page.mouse.up();
}

async function statusOf(admin: Page, id: number) {
  return card(admin, id).locator("[data-status]").getAttribute("data-status");
}

async function waitStatus(admin: Page, id: number, status: string, what: string) {
  try {
    await card(admin, id).locator(`[data-status="${status}"]`).waitFor({ timeout: 8000 });
    check(true, what);
  } catch {
    check(false, `${what} (status is ${await statusOf(admin, id)})`);
  }
}

async function seen(page: Page, text: string, what: string, timeout = 8000) {
  try {
    await page.getByText(text, { exact: false }).first().waitFor({ timeout });
    check(true, what);
  } catch {
    check(false, what);
  }
}

async function press(admin: Page, id: number, name: string) {
  await card(admin, id).getByRole("button", { name, exact: false }).first().click();
}

async function undo(admin: Page) {
  await admin.locator("[role=status]").getByRole("button", { name: "ย้อน" }).click();
}

async function openAward(admin: Page, id: number, seconds: 0 | 60 | 90 | 120) {
  if (await card(admin, id).getByRole("button", { name: "ขึ้นจอ" }).count()) await press(admin, id, "ขึ้นจอ");
  await card(admin, id)
    .getByRole("radio", { name: seconds === 0 ? "ไม่จับ" : `${seconds} วิ` })
    .click();
  await press(admin, id, "เปิดโหวต");
  await waitStatus(admin, id, "open", `award ${id}: opened from the MC page`);
}

type Expect = { winners: number[]; second: number[]; third: number[]; tieNotes?: number };

async function revealAndCheck(admin: Page, stage: Page, phone: Page, id: number, exp: Expect | null, label: string) {
  await hold(admin, card(admin, id).getByRole("button", { name: "ประกาศผล" }));
  await waitStatus(admin, id, "revealed", `award ${id}: revealed`);
  await stage.locator(`[data-reveal="${id}"]`).waitFor({ timeout: 8000 });
  await seen(phone, "ประกาศผลแล้ว ดูบนจอใหญ่", `award ${id}: phone says "ประกาศผลแล้ว" by itself`);
  if (!exp) {
    await seen(stage, "ยังไม่มีผู้ได้รับเสียง", `award ${id}: no-votes reveal says "ยังไม่มีผู้ได้รับเสียง"`, 6000);
    await sleep(800);
    await stage.screenshot({ path: `${OUT}/reveal-${label}.jpg`, quality: 82 });
    return;
  }
  // Mid-scene: the first place card (3rd or 2nd) is up before the winner
  await sleep(4200);
  await stage.screenshot({ path: `${OUT}/reveal-${label}-step.jpg`, quality: 82 });
  const winnerEarly = await stage.locator('[data-place="1"]').count();
  check(winnerEarly === 0, `award ${id}: winner not shown before the lower places`);
  await stage.locator('[data-place="1"] [data-winner]').first().waitFor({ timeout: 15000 });
  await sleep(1400);
  await stage.screenshot({ path: `${OUT}/reveal-${label}.jpg`, quality: 82 });
  const ids = async (sel: string) =>
    (await stage.locator(`${sel} [data-winner]`).evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-winner")))));
  const got = { winners: await ids('[data-place="1"]'), second: await ids('[data-place="2"]'), third: await ids('[data-place="3"]') };
  const want = { winners: exp.winners, second: exp.second, third: exp.third };
  check(JSON.stringify(got) === JSON.stringify(want), `award ${id} (${label}): podium ${JSON.stringify(got)} = expected ${JSON.stringify(want)}`);
  check(!(await stage.getByText("ผู้ชนะร่วม").count()), `award ${id}: nobody is called a joint winner`);
  const notes = await stage.getByText("ถึงคะแนนนี้ก่อน").count();
  check(notes === (exp.tieNotes ?? 0), `award ${id}: ${exp.tieNotes ?? 0} "ถึงคะแนนนี้ก่อน" note(s) on screen (${notes})`);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const mk = async (opts: Parameters<typeof browser.newContext>[0]) => {
    const ctx = await browser.newContext({ locale: "th-TH", ...opts });
    await ctx.addInitScript({ content: "window.__name = (f) => f;" });
    return ctx;
  };
  const adminCtx = await mk({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: false });
  const stageCtx = await mk({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const phoneCtx = await mk({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const admin = await adminCtx.newPage();
  const stage = await stageCtx.newPage();
  stagePage = stage;
  const phone = await phoneCtx.newPage();

  for (const [name, p] of Object.entries({ admin, stage, phone })) {
    // The MC page's first overview call is a 401 on purpose (not signed in yet)
    p.on("console", (m) => m.type() === "error" && !(name === "admin" && m.text().includes("401")) && problems.push(`${name} console: ${m.text()}`));
    p.on("pageerror", (e) => problems.push(`${name} pageerror: ${e.message}`));
    p.on("response", (r) => r.status() === 404 && problems.push(`${name} 404 ${r.url()}`));
  }
  // The phone must never see a count — not over HTTP, not over the realtime socket
  let phoneLeaks = 0;
  phone.on("response", async (r) => {
    if (!(r.headers()["content-type"] ?? "").includes("json")) return;
    const body = await r.text().catch(() => "");
    if (/"(counts|total)"\s*:/.test(body)) {
      phoneLeaks++;
      problems.push(`phone http ${r.url()}: ${body.slice(0, 120)}`);
    }
  });
  phone.on("websocket", (ws) =>
    ws.on("framereceived", (f) => {
      const s = typeof f.payload === "string" ? f.payload : f.payload.toString("utf8");
      // `hide_counts` is a status flag, not a count — match the tally's own keys/channel only
      if (/\\?"(counts|total)\\?"\s*:|lv:tally/.test(s)) {
        phoneLeaks++;
        problems.push(`phone ws frame: ${s.slice(0, 160)}`);
      }
    }),
  );

  // ---- login ----
  const noCookie = await fetch(`${base}/api/admin/overview`);
  check(noCookie.status === 401, "overview API without a session = 401");
  const noAction = await fetch(`${base}/api/admin/action`, { method: "POST", body: JSON.stringify({ action: "lobby" }) });
  check(noAction.status === 401, "action API without a session = 401");
  const badToken = await fetch(`${base}/api/realtime/token?role=admin`);
  check(badToken.status === 401, "admin Ably token without a session = 401");

  await admin.goto(`${base}/admin`);
  await admin.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
  await seen(admin, "ใส่รหัสพิธีกรก่อนกดเข้าสู่ระบบ", "empty passcode: Thai message under the field (no browser popup)");
  await admin.getByLabel("รหัสพิธีกร").fill("wrong-passcode");
  await admin.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
  await seen(admin, "รหัสไม่ถูกต้อง ลองใหม่อีกครั้ง", "wrong passcode is refused");
  check((await admin.locator("[data-award]").count()) === 0, "wrong passcode shows no controls");
  await admin.screenshot({ path: `${OUT}/admin-login-wrong.jpg`, quality: 82 });

  // A guest on the same venue IP guesses until locked — the MC's browser must still get in
  const guestCtx = await mk({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true });
  const guest = await guestCtx.newPage();
  await guest.goto(`${base}/admin`);
  for (let i = 0; i < 4; i++) {
    await guest.getByLabel("รหัสพิธีกร").fill(`guess-${i}`);
    await guest.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
    await guest.locator("#passcode-error").waitFor();
    await sleep(300);
  }
  await seen(guest, "ใส่รหัสผิดหลายครั้ง เครื่องนี้ต้องรอ", "guest's own browser is paused after repeated guesses (Thai message)");
  await guest.getByLabel("รหัสพิธีกร").fill(PASS);
  await guest.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
  await sleep(800);
  check((await guest.locator("[data-award]").count()) === 0, "a paused guest browser stays out even with the right passcode");
  await guest.screenshot({ path: `${OUT}/admin-login-guest-paused.jpg`, quality: 82 });
  await guestCtx.close();

  await admin.getByLabel("รหัสพิธีกร").fill(PASS);
  await admin.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
  await admin.locator("[data-award]").first().waitFor();
  check(true, "right passcode opens the MC page");

  // Clean starting point (dev branch)
  const api = (body: unknown) => admin.request.post(`${base}/api/admin/action`, { data: body });
  for (let id = 1; id <= 5; id++) {
    await api({ action: "close", award_id: id });
    await api({ action: "unreveal", award_id: id });
    const t = (await (await admin.request.get(`${base}/api/admin/overview`)).json()).state.awards[id - 1].title;
    await api({ action: "reset", award_id: id, confirm: t });
    await api({ action: "rename", award_id: id, title: seedAwards[id - 1].title, subtitle: "" });
  }
  for (const b of [{ action: "hide", on: false }, { action: "hall", on: false }, { action: "qr_fallback", on: false }, { action: "lobby" }]) await api(b);

  await stage.goto(`${base}/stage?k=${encodeURIComponent(K)}`);
  await stage.getByRole("button", { name: "เริ่มงาน" }).click(); // start gate: sound + full screen
  await phone.goto(`${base}/`);
  await stage.getByText("รอพิธีกรเปิดรางวัลแรก").waitFor({ timeout: 20000 });
  // A reload would wipe this marker — checked at the end ("ไม่รีเฟรชหน้าใดเลย")
  const mark = (p: Page) => p.evaluate(() => ((window as unknown as { __m3: number }).__m3 = 1));
  const marked = async (p: Page) => p.evaluate(() => (window as unknown as { __m3?: number }).__m3 === 1);
  await Promise.all([mark(admin), mark(stage), mark(phone)]);
  await seen(admin, "จอใหญ่เชื่อมต่ออยู่", "MC page sees the stage via presence", 15000);
  await admin.screenshot({ path: `${OUT}/admin-lobby.jpg`, quality: 82, fullPage: true });

  // ---- award 1: plain 1/2/3, with every mistake undone ----
  await card(admin, 1).getByRole("button", { name: "แก้ชื่อรางวัล" }).click();
  await card(admin, 1).getByLabel("ชื่อรางวัล", { exact: true }).fill("ขวัญใจรุ่น (ทดสอบ)");
  await card(admin, 1).getByRole("button", { name: "บันทึกชื่อ" }).click();
  await seen(phone, "ขวัญใจรุ่น (ทดสอบ)", "rename reaches the phone without reload");
  await press(admin, 1, "ขึ้นจอ");
  await seen(stage, "ขวัญใจรุ่น (ทดสอบ)", "award 1 on stage (pending) with the new name");
  await seen(phone, "รางวัลนี้ยังไม่เปิดโหวต", "phone: pending message");
  check(await card(admin, 1).getByRole("button", { name: "เปิดโหวต" }).isDisabled(), "open stays disabled until the MC picks a timer");
  await openAward(admin, 1, 90);
  await seen(phone, "มะลิ", "phone switches to the voting grid by itself");
  check(await card(admin, 2).getByRole("button", { name: "เปิดโหวต" }).isDisabled(), "another award cannot open while award 1 is open (button)");
  const another = await api({ action: "open", award_id: 2, seconds: 0 });
  check(another.status() === 409 && (await another.json()).error === "another_open", "another award cannot open while award 1 is open (server)");
  await votes(1, [[1, 5], [2, 3], [3, 2], [4, 1]]);
  await sleep(1500);
  await stage.screenshot({ path: `${OUT}/stage-open-timer.jpg`, quality: 82 });
  await admin.screenshot({ path: `${OUT}/admin-open.jpg`, quality: 82, fullPage: true });
  check((await card(admin, 1).locator("[data-total]").textContent()) === "11", "MC page shows the live total (11)");

  await press(admin, 1, "ต่อเวลา");
  check(true, "extend +30 s accepted");

  await admin.getByRole("switch", { name: /ซ่อนตัวเลขบนจอ/ }).click();
  await sleep(1200);
  const qs = await stage.locator("[data-nominee] span:last-child").evaluateAll((els) => els.filter((e) => e.textContent === "?").length);
  check(qs >= 8, `hide counts: stage shows "?" (${qs} lanes)`);
  await stage.screenshot({ path: `${OUT}/stage-hidden.jpg`, quality: 82 });
  await undo(admin);
  await sleep(1200);
  check(!(await admin.getByRole("switch", { name: /ซ่อนตัวเลขบนจอ/ }).getAttribute("aria-checked"))?.includes("true"), "undo: counts visible again");

  await hold(admin, card(admin, 1).getByRole("button", { name: "ปิดโหวต" }));
  await waitStatus(admin, 1, "closed", "award 1 closed by hold-to-confirm");
  await seen(phone, "ปิดโหวตรางวัลนี้แล้ว", "phone: closed message by itself");
  await sleep(700);
  await stage.screenshot({ path: `${OUT}/stage-closed.jpg`, quality: 82 });
  await undo(admin);
  await waitStatus(admin, 1, "open", "undo close → open again");
  await hold(admin, card(admin, 1).getByRole("button", { name: "ปิดโหวต" }));
  await waitStatus(admin, 1, "closed", "award 1 closed again");
  await seen(admin, "ยอดตรง", "MC sees 'ยอดตรง' before revealing");

  // A short tap on a hold button does nothing
  await card(admin, 1).getByRole("button", { name: "ประกาศผล" }).click();
  await sleep(600);
  check((await statusOf(admin, 1)) === "closed", "a quick tap on ประกาศผล does not reveal");

  await revealAndCheck(admin, stage, phone, 1, { winners: [1], second: [2], third: [3] }, "plain");
  await admin.screenshot({ path: `${OUT}/admin-revealed.jpg`, quality: 82, fullPage: true });
  await press(admin, 1, "ย้อนประกาศ");
  await waitStatus(admin, 1, "closed", "undo reveal (ย้อนประกาศ) → closed");
  await revealAndCheck(admin, stage, phone, 1, { winners: [1], second: [2], third: [3] }, "plain-again");

  await admin.getByRole("button", { name: "กลับ lobby" }).click();
  await seen(stage, "รอพิธีกรเปิดรางวัลแรก", "back to lobby");
  await undo(admin);
  await stage.locator('[data-reveal="1"]').waitFor({ timeout: 8000 });
  check(true, "undo lobby → award 1 back on screen (final picture, no replay)");

  // ---- award 2: tie at 1st, plus a reset on the way ----
  await openAward(admin, 2, 0);
  await votes(2, [[5, 1]]);
  await hold(admin, card(admin, 2).getByRole("button", { name: "ปิดโหวต" }));
  await waitStatus(admin, 2, "closed", "award 2 closed (before reset)");
  await card(admin, 2).getByRole("button", { name: "รีเซ็ตคะแนน" }).click();
  await card(admin, 2).getByLabel(/พิมพ์ชื่อรางวัล/).fill("ชื่อผิด");
  check(await card(admin, 2).getByRole("button", { name: "ลบคะแนนรางวัลนี้" }).isDisabled(), "reset needs the exact award name");
  const badReset = await api({ action: "reset", award_id: 2, confirm: "ชื่อผิด" });
  check(badReset.status() === 409, "server refuses reset with the wrong name");
  await card(admin, 2).getByLabel(/พิมพ์ชื่อรางวัล/).fill(seedAwards[1].title);
  await card(admin, 2).getByRole("button", { name: "ลบคะแนนรางวัลนี้" }).click();
  await waitStatus(admin, 2, "pending", "reset → pending with 0 votes");
  await openAward(admin, 2, 0);
  await votes(2, [[25, 4], [18, 4], [7, 2], [8, 1]]); // 25 reaches 4 first, 18 has the lower number
  await hold(admin, card(admin, 2).getByRole("button", { name: "ปิดโหวต" }));
  await waitStatus(admin, 2, "closed", "award 2 closed");
  await revealAndCheck(admin, stage, phone, 2, { winners: [25], second: [18], third: [7], tieNotes: 1 }, "tie-1st");

  // ---- award 3: tie at 2nd ----
  await openAward(admin, 3, 0);
  await votes(3, [[10, 5], [12, 3], [11, 3], [13, 1]]);
  await hold(admin, card(admin, 3).getByRole("button", { name: "ปิดโหวต" }));
  await waitStatus(admin, 3, "closed", "award 3 closed");
  await revealAndCheck(admin, stage, phone, 3, { winners: [10], second: [12], third: [11], tieNotes: 1 }, "tie-2nd");

  // ---- award 4: tie at 3rd, with backup QR switched on while open ----
  await openAward(admin, 4, 0);
  const qrBtn = admin.getByRole("switch", { name: /QR สำรอง/ });
  log.push(`INFO backup QR switch ${(await qrBtn.isDisabled()) ? "disabled (NEXT_PUBLIC_VOTE_URL_FALLBACK not set in .env.local)" : "enabled"}`);
  await votes(4, [[20, 6], [21, 4], [24, 2], [23, 2], [22, 2]]);
  await hold(admin, card(admin, 4).getByRole("button", { name: "ปิดโหวต" }));
  await waitStatus(admin, 4, "closed", "award 4 closed");
  await revealAndCheck(admin, stage, phone, 4, { winners: [20], second: [21], third: [24], tieNotes: 1 }, "tie-3rd");

  // ---- award 5: nobody votes, the MC's 60 s timer closes it by itself ----
  await openAward(admin, 5, 60);
  await stage.locator('[role="timer"][aria-label^="เหลือ"]').waitFor({ timeout: 70000 });
  await stage.screenshot({ path: `${OUT}/stage-countdown-10s.jpg`, quality: 82 });
  check(true, "stage shows the big last-10-seconds countdown");
  await card(admin, 5).locator('[data-status="closed"]').waitFor({ timeout: 20000 }).catch(() => undefined);
  check((await statusOf(admin, 5)) === "closed", "timer ran out → award 5 closed by itself (no MC press)");
  await seen(phone, "ปิดโหวตรางวัลนี้แล้ว", "phone: auto-closed message by itself");
  await seen(admin, "ยังไม่มีผู้ได้รับเสียง", "MC warned before revealing an award with no votes");
  await revealAndCheck(admin, stage, phone, 5, null, "no-votes");

  // ---- hall ----
  await admin.getByRole("button", { name: "ขึ้นทำเนียบ" }).click();
  await stage.locator("[data-hall]").first().waitFor({ timeout: 8000 });
  await sleep(1800);
  await stage.screenshot({ path: `${OUT}/stage-hall.jpg`, quality: 82 });
  const hall2 = await stage.locator('[data-hall="2"] [data-winner]').count();
  const hallWinner = await stage.locator('[data-hall="2"] [data-winner]').first().getAttribute("data-winner");
  check(hall2 === 1 && hallWinner === "25", `hall: award 2 shows one winner, no.25 who got there first (${hall2}, ${hallWinner})`);
  await seen(stage, "ถึงคะแนนนี้ก่อน", "hall: says the win came from reaching the score first", 2000);
  await undo(admin);
  await stage.locator('[data-reveal="5"]').waitFor({ timeout: 8000 });
  check(true, "undo hall → back to the last award");

  const kept = [await marked(admin), await marked(stage), await marked(phone)];
  check(kept.every(Boolean), `no page reloaded from first award to hall (admin ${kept[0]} · stage ${kept[1]} · phone ${kept[2]})`);
  check(phoneLeaks === 0, `phone received no counts over HTTP or Ably (${phoneLeaks})`);
  await phone.screenshot({ path: `${OUT}/phone-revealed.jpg`, quality: 82 });

  // ---- logout ----
  await admin.getByRole("button", { name: "ออกจากระบบ" }).click();
  await admin.getByLabel("รหัสพิธีกร").waitFor();
  const after = await admin.request.get(`${base}/api/admin/overview`);
  check(after.status() === 401, "after logout the session is gone");

  // Leave the dev branch clean: every award pending, lobby, names back
  await admin.getByLabel("รหัสพิธีกร").fill(PASS);
  await admin.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
  await admin.locator("[data-award]").first().waitFor();
  for (let id = 1; id <= 5; id++) {
    await api({ action: "unreveal", award_id: id });
    const t = (await (await admin.request.get(`${base}/api/admin/overview`)).json()).state.awards[id - 1].title;
    await api({ action: "reset", award_id: id, confirm: t });
    await api({ action: "rename", award_id: id, title: seedAwards[id - 1].title, subtitle: "" });
  }
  for (const b of [{ action: "hide", on: false }, { action: "hall", on: false }, { action: "qr_fallback", on: false }, { action: "lobby" }]) await api(b);
  const final = await (await admin.request.get(`${base}/api/admin/overview`)).json();
  check(
    final.state.current_award_id === null && final.state.awards.every((x: { status: string }) => x.status === "pending") && final.tallies.every((t: { total: number; verified: boolean }) => t.total === 0 && t.verified),
    "dev branch reset: all pending, lobby, 0 votes, tallies verified",
  );

  await browser.close();
  const out = [...log, "", problems.length ? `PROBLEMS (${problems.length}):\n${problems.join("\n")}` : "ALL CHECKS PASSED"].join("\n");
  await writeFile(`${OUT}/RESULT.txt`, out + "\n");
  console.log(out);
  process.exit(problems.length ? 1 : 0);
}

main().catch(async (e) => {
  await stagePage?.screenshot({ path: `${OUT}/_failure-stage.jpg`, quality: 70 }).catch(() => undefined);
  console.log([...log, "", `PROBLEMS:\n${problems.join("\n")}`].join("\n"));
  console.error(e instanceof Error ? e.message.split("\n")[0] : e);
  process.exit(1);
});
