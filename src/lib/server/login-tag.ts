import "server-only";
import type { NextResponse } from "next/server";
import { BASE_PATH } from "@/lib/base-path";
import { LOGIN_TAG_COOKIE, mintTag, parseTag } from "@/lib/server/login-guard";

// Hand the browser its login tag (login-guard.ts) the moment the MC page loads, so the MC's
// browser already "existed" before anyone at the venue starts guessing.
export function ensureLoginTag(existing: { id: string; issuedAt: number } | null): {
  tag: { id: string; issuedAt: number };
  set: (res: NextResponse) => void;
} {
  if (existing) return { tag: existing, set: () => undefined };
  const value = mintTag();
  const tag = parseTag(value)!;
  return {
    tag,
    set: (res: NextResponse) => {
      res.cookies.set(LOGIN_TAG_COOKIE, value, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: BASE_PATH,
        maxAge: 30 * 24 * 60 * 60,
      });
    },
  };
}
