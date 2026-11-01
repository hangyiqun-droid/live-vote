import "server-only";
import { NextResponse } from "next/server";

// Every API response is live data — never cache it anywhere (browser, CDN, any proxy in front)
export function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

// Never leak raw Postgres/Ably/driver messages to clients
export function serverError(where: string, e: unknown): NextResponse {
  console.error(`[${where}]`, e instanceof Error ? e.message : "unknown error");
  return json({ error: "unavailable" }, 503);
}
