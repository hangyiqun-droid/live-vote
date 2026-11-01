// Read-only smoke test after a deploy. Never votes, never logs in, never changes state —
// safe on production.
//
//   pnpm smoke https://your-app.example.com [--version v1.0.0-build001]
//
// NEXT_PUBLIC_BASE_PATH (env, optional) when the app is served under a sub-path.
// VERCEL_AUTOMATION_BYPASS_SECRET (env, optional) for a protected preview.
export {};
const argv = process.argv.slice(2);
const origin = (argv.find((a) => /^https?:/.test(a)) ?? "").replace(/\/$/, "");
const vi = argv.indexOf("--version");
const wantVersion = vi >= 0 ? argv[vi + 1] : null;
if (!origin) {
  console.error("usage: pnpm smoke <https://host> [--version vX.Y.Z-buildNNN]");
  process.exit(2);
}
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const COOKIE_PATH = new RegExp(`Path=${(BASE_PATH || "/").replace(/[/]/g, "\\/")}(;|$)`, "i");
const base = `${origin}${BASE_PATH}`;
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const problems: string[] = [];
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${what}`);
  if (!ok) problems.push(what);
};

async function get(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (BYPASS) headers.set("x-vercel-protection-bypass", BYPASS);
  return fetch(path.startsWith("http") ? path : `${base}${path}`, { redirect: "manual", ...init, headers });
}

// Ably key "app.key:secret", Postgres URLs, env names that must stay on the server
const SECRET_PATTERNS: [string, RegExp][] = [
  ["Ably API key", /\b[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}:[A-Za-z0-9_+/=-]{20,}/],
  ["Postgres URL", /postgres(ql)?:\/\/[^"'\s]+@/],
  ["server env name", /\b(ABLY_API_KEY|DATABASE_URL|ADMIN_PASSCODE|ADMIN_SESSION_SECRET|DEVICE_SALT|STAGE_KEY)\b/],
];

async function main() {
  console.log(`smoke ${base}${BYPASS ? " (vercel bypass)" : ""}`);

  const health = await get("/api/health");
  const h = (await health.json().catch(() => ({}))) as { ok?: boolean; version?: string; db_ms?: number };
  check(health.status === 200 && h.ok === true, `/api/health 200 ok (db ${h.db_ms ?? "?"} ms, ${h.version ?? "no version"})`);
  if (wantVersion) check(h.version === wantVersion, `deployed version = ${wantVersion} (got ${h.version})`);

  const pages: Record<string, string> = {};
  for (const p of ["", "/stage", "/admin"]) {
    const r = await get(p);
    pages[p] = await r.text();
    check(r.status === 200, `GET ${BASE_PATH}${p} → 200 (got ${r.status})`);
  }

  const state = await get("/api/state");
  const s = (await state.json().catch(() => ({}))) as { awards?: { id: number; status: string }[] };
  check(state.status === 200 && s.awards?.length === 5, `/api/state lists 5 awards (${s.awards?.map((a) => a.status).join(",") ?? "none"})`);
  check(!JSON.stringify(s).includes('"counts"'), "/api/state carries no counts (phones never see the tally)");
  check(state.headers.get("cache-control")?.includes("no-store") === true, "/api/state is never cached");

  check((await get("/api/stage/snapshot")).status === 401, "stage snapshot without the key → 401");
  check((await get("/api/realtime/token?role=stage")).status === 401, "stage Ably token without the key → 401");
  check((await get("/api/realtime/token?role=admin")).status === 401, "MC Ably token without a session → 401");
  const overview = await get("/api/admin/overview");
  check(overview.status === 401, "MC overview without a session → 401");
  const tag = (overview.headers.getSetCookie?.() ?? []).find((c) => c.startsWith("lv_login="));
  check(!!tag && COOKIE_PATH.test(tag) && /HttpOnly/i.test(tag), `MC login tag cookie issued (Path=${BASE_PATH || "/"}, HttpOnly)`);

  const mobile = await get("/api/realtime/token");
  const tr = (await mobile.json().catch(() => ({}))) as { capability?: string };
  const cap = tr.capability ? (JSON.parse(tr.capability) as Record<string, string[]>) : {};
  check(mobile.status === 200 && Object.keys(cap).join() === "lv:event", `phone Ably token can only hear lv:event (${Object.keys(cap).join() || "none"})`);

  const dev = await get("/api/device", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  const devCookie = (dev.headers.getSetCookie?.() ?? []).find((c) => c.startsWith("lv_dev="));
  check(
    dev.status === 200 && !!devCookie && COOKIE_PATH.test(devCookie) && /HttpOnly/i.test(devCookie),
    `device cookie lv_dev set on ${new URL(origin).hostname} (Path=${BASE_PATH || "/"}, HttpOnly${/Secure/i.test(devCookie ?? "") ? ", Secure" : ", NOT Secure"})`,
  );
  if (origin.startsWith("https:")) check(/Secure/i.test(devCookie ?? ""), "device cookie is Secure on https");

  // Every JS chunk the three pages load: no server secret may ever be inside
  const chunks = new Set<string>();
  for (const html of Object.values(pages)) {
    for (const m of html.matchAll(new RegExp(`["'](${BASE_PATH.replace(/[/]/g, "\\/")}\\/_next\\/static\\/[^"']+\\.js)["']`, "g"))) chunks.add(m[1]);
  }
  let leaks = 0;
  for (const c of chunks) {
    const js = await (await get(`${origin}${c}`)).text();
    for (const [name, re] of SECRET_PATTERNS) {
      if (re.test(js)) {
        leaks++;
        console.log(`  ${name} pattern in ${c}`);
      }
    }
  }
  check(chunks.size > 0 && leaks === 0, `no secret pattern in ${chunks.size} JS chunks`);
  for (const [p, html] of Object.entries(pages)) {
    const hit = SECRET_PATTERNS.find(([, re]) => re.test(html));
    check(!hit, `no secret pattern in ${BASE_PATH}${p || "/"} HTML${hit ? ` (${hit[0]})` : ""}`);
  }

  console.log(problems.length ? `\nFAILED ${problems.length}` : "\nALL PASS");
  process.exit(problems.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(2);
});
