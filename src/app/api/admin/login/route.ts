import type { NextRequest, NextResponse } from "next/server";
import { makeSession, passcodeMatches, setAdminCookie } from "@/lib/server/admin-session";
import { json } from "@/lib/server/http";
import { canTry, LOGIN_TAG_COOKIE, parseTag, recordFail, recordSuccess } from "@/lib/server/login-guard";
import { ensureLoginTag } from "@/lib/server/login-tag";
import { clientIp } from "@/lib/server/rate-limit";

// wrong guesses lock the guessing *browser* (growing wait), never the venue IP —
// see src/lib/server/login-guard.ts.
export async function POST(req: NextRequest) {
  const ip = clientIp(req.headers);
  const existing = parseTag(req.cookies.get(LOGIN_TAG_COOKIE)?.value);
  const { tag, set } = ensureLoginTag(existing);
  const reply = (res: NextResponse) => {
    set(res);
    return res;
  };

  const gate = canTry(ip, tag);
  if (!gate.ok) return reply(json({ error: "locked", retry_after: gate.retryAfter }, 429));

  let passcode: unknown;
  try {
    passcode = (await req.json())?.passcode;
  } catch {
    passcode = undefined;
  }

  if (!passcodeMatches(passcode)) {
    const wait = recordFail(ip, tag);
    return reply(
      wait
        ? json({ error: "locked", retry_after: Math.ceil(wait / 1000) }, 429)
        : json({ error: "wrong", retry_after: 0 }, 401),
    );
  }

  recordSuccess(tag);
  const res = json({ ok: true });
  setAdminCookie(res, makeSession());
  return reply(res);
}
