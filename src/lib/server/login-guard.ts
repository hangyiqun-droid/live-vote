import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// MC login throttle (M5). The whole venue shares one Wi-Fi IP, so locking an IP would lock the MC
// out whenever a guest guesses the passcode. Instead:
// 1. Each browser carries a signed "login tag" cookie. Wrong guesses slow down and then lock
//    *that browser only*, with a growing wait (no wait for the first few typos).
// 2. Per IP we only count wrong guesses from browsers. When an IP floods (a script, many tags),
//    tags minted *after* the flood began are refused until it calms down — a browser that was
//    already open (the MC's) keeps its own budget and can still sign in.
// Memory only, per function instance — like the vote limiter, it is a speed bump, not a vault.
// The real protection is a long random ADMIN_PASSCODE.

export const LOGIN_TAG_COOKIE = "event_login";
export const FREE_FAILS = 3; // typos before any wait
const MAX_WAIT_MS = 5 * 60_000;
const IP_WINDOW_MS = 10 * 60_000;
export const IP_FLOOD_FAILS = 30; // wrong guesses per IP per 10 min before new tags are refused
const MAX_ENTRIES = 5_000;

type TagState = { fails: number; lockedUntil: number; last: number };
type IpState = { fails: number[]; floodSince: number };

const tags = new Map<string, TagState>();
const ips = new Map<string, IpState>();

function secret(): string {
  const s = process.env.ADMIN_SESSION_SECRET;
  if (!s) throw new Error("ADMIN_SESSION_SECRET is not set");
  return s;
}

const sign = (payload: string) => createHmac("sha256", secret()).update(`login-tag:${payload}`).digest("base64url");

// Cookie value: "<issuedAtMs>.<random>.<hmac>"
export function mintTag(now = Date.now()): string {
  const body = `${now}.${randomBytes(12).toString("base64url")}`;
  return `${body}.${sign(body)}`;
}

export function parseTag(value: string | undefined): { id: string; issuedAt: number } | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 3 || !/^\d+$/.test(parts[0])) return null;
  const body = `${parts[0]}.${parts[1]}`;
  const want = Buffer.from(sign(body));
  const got = Buffer.from(parts[2]);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  return { id: body, issuedAt: Number(parts[0]) };
}

// Wait after the n-th wrong guess: 0 for the first FREE_FAILS, then 15 s, 30 s, 60 s … capped at 5 min
export function waitAfter(fails: number): number {
  if (fails < FREE_FAILS) return 0;
  return Math.min(MAX_WAIT_MS, 15_000 * 2 ** (fails - FREE_FAILS));
}

function ipState(ip: string, now: number): IpState {
  let s = ips.get(ip);
  if (!s) {
    if (ips.size > MAX_ENTRIES) ips.clear();
    s = { fails: [], floodSince: 0 };
    ips.set(ip, s);
  }
  s.fails = s.fails.filter((t) => now - t < IP_WINDOW_MS);
  if (s.fails.length < IP_FLOOD_FAILS) s.floodSince = 0;
  return s;
}

export type Gate = { ok: true } | { ok: false; retryAfter: number };

// Before checking the passcode: may this browser try now?
export function canTry(ip: string, tag: { id: string; issuedAt: number }, now = Date.now()): Gate {
  const t = tags.get(tag.id);
  if (t && t.lockedUntil > now) return { ok: false, retryAfter: Math.ceil((t.lockedUntil - now) / 1000) };
  const s = ipState(ip, now);
  if (s.floodSince && tag.issuedAt >= s.floodSince) {
    const calm = (s.fails[0] ?? now) + IP_WINDOW_MS;
    return { ok: false, retryAfter: Math.max(1, Math.ceil((calm - now) / 1000)) };
  }
  return { ok: true };
}

// After a wrong passcode. Returns how long this browser must now wait (0 = may retry at once).
export function recordFail(ip: string, tag: { id: string }, now = Date.now()): number {
  const t = tags.get(tag.id) ?? { fails: 0, lockedUntil: 0, last: now };
  // A browser that behaved for an hour starts over
  if (now - t.last > 60 * 60_000) t.fails = 0;
  t.fails += 1;
  t.last = now;
  const wait = waitAfter(t.fails);
  t.lockedUntil = wait ? now + wait : 0;
  if (tags.size > MAX_ENTRIES) tags.clear();
  tags.set(tag.id, t);

  const s = ipState(ip, now);
  s.fails.push(now);
  if (s.fails.length >= IP_FLOOD_FAILS && !s.floodSince) s.floodSince = now;
  return wait;
}

export function recordSuccess(tag: { id: string }) {
  tags.delete(tag.id);
}

// Tests only
export function resetLoginGuard() {
  tags.clear();
  ips.clear();
}
