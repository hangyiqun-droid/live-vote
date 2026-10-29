import type { NextRequest } from "next/server";
import { makeSession, passcodeMatches, setAdminCookie } from "@/lib/server/admin-session";
import { json } from "@/lib/server/http";
import { clientIp } from "@/lib/server/rate-limit";

// SPEC 4.3: 5 wrong passcodes within a minute → that IP waits a minute. Memory only.
const MAX_FAILS = 5;
const WINDOW_MS = 60_000;
const fails = new Map<string, { n: number; first: number; lockedUntil: number }>();

export async function POST(req: NextRequest) {
  const ip = clientIp(req.headers);
  const now = Date.now();
  const f = fails.get(ip);
  if (f && f.lockedUntil > now) {
    return json({ error: "locked", retry_after: Math.ceil((f.lockedUntil - now) / 1000) }, 429);
  }

  let passcode: unknown;
  try {
    passcode = (await req.json())?.passcode;
  } catch {
    passcode = undefined;
  }

  if (!passcodeMatches(passcode)) {
    const cur = f && now - f.first < WINDOW_MS ? f : { n: 0, first: now, lockedUntil: 0 };
    cur.n += 1;
    if (cur.n >= MAX_FAILS) cur.lockedUntil = now + WINDOW_MS;
    if (fails.size > 1_000) fails.clear();
    fails.set(ip, cur);
    return json({ error: cur.lockedUntil > now ? "locked" : "wrong", retry_after: 60 }, cur.lockedUntil > now ? 429 : 401);
  }

  fails.delete(ip);
  const res = json({ ok: true });
  setAdminCookie(res, makeSession());
  return res;
}
