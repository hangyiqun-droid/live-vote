import "server-only";
import { createHmac, randomUUID } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { COOKIE_PATH } from "@/lib/base-path";

// random device id in an httpOnly cookie + a localStorage copy on the phone.
// The DB only ever sees HMAC(DEVICE_SALT, device_id).
export const DEVICE_COOKIE = "lv_dev";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

// Cookie wins; fall back to the client's localStorage copy (Safari may drop cookies); else mint one
export function resolveDeviceId(req: NextRequest, fromClient?: unknown): { id: string; fresh: boolean } {
  const cookie = req.cookies.get(DEVICE_COOKIE)?.value;
  if (isUuid(cookie)) return { id: cookie.toLowerCase(), fresh: false };
  if (isUuid(fromClient)) return { id: fromClient.toLowerCase(), fresh: true };
  return { id: randomUUID(), fresh: true };
}

export function setDeviceCookie(res: NextResponse, id: string) {
  res.cookies.set(DEVICE_COOKIE, id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: COOKIE_PATH,
    maxAge: 60 * 60 * 24 * 30,
  });
}

export function deviceHash(id: string): Buffer {
  const salt = process.env.DEVICE_SALT;
  if (!salt) throw new Error("DEVICE_SALT is not set");
  return createHmac("sha256", salt).update(id).digest();
}

// the lobby counter's own hash. Domain-separated from deviceHash() so scanned_devices can
// never be joined to ballots — same salt, different input.
export function scanHash(id: string): Buffer {
  const salt = process.env.DEVICE_SALT;
  if (!salt) throw new Error("DEVICE_SALT is not set");
  return createHmac("sha256", salt).update(`scan:${id}`).digest();
}
