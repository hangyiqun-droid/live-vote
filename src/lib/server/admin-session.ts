import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { COOKIE_PATH } from "@/lib/base-path";

// passcode from env ADMIN_PASSCODE, compared timing-safe → signed httpOnly cookie, 12 h.
export const ADMIN_COOKIE = "lv_admin";
const SESSION_MS = 12 * 60 * 60 * 1000;

function secret(): string {
  const s = process.env.ADMIN_SESSION_SECRET;
  if (!s) throw new Error("ADMIN_SESSION_SECRET is not set");
  return s;
}

const sign = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url");

function safeEqual(a: string, b: string): boolean {
  // Hash both sides first so the comparison takes the same time whatever the lengths are
  const ha = createHmac("sha256", "cmp").update(a).digest();
  const hb = createHmac("sha256", "cmp").update(b).digest();
  return timingSafeEqual(ha, hb) && a.length === b.length;
}

export function passcodeMatches(input: unknown): boolean {
  const want = process.env.ADMIN_PASSCODE;
  if (!want || typeof input !== "string" || input.length === 0 || input.length > 200) return false;
  return safeEqual(input, want);
}

// Cookie value: "<expiresAtMs>.<hmac>"
export function makeSession(now = Date.now()): string {
  const exp = String(now + SESSION_MS);
  return `${exp}.${sign(`admin:${exp}`)}`;
}

export function isValidSession(value: string | undefined, now = Date.now()): boolean {
  if (!value) return false;
  const [exp, sig] = value.split(".");
  if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) < now) return false;
  try {
    return safeEqual(sig, sign(`admin:${exp}`));
  } catch {
    return false;
  }
}

export const isAdmin = (req: NextRequest) => isValidSession(req.cookies.get(ADMIN_COOKIE)?.value);

export function setAdminCookie(res: NextResponse, value: string) {
  res.cookies.set(ADMIN_COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: COOKIE_PATH,
    maxAge: SESSION_MS / 1000,
  });
}

export function clearAdminCookie(res: NextResponse) {
  res.cookies.set(ADMIN_COOKIE, "", { httpOnly: true, path: COOKIE_PATH, maxAge: 0 });
}
