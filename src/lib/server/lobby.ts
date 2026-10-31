import "server-only";
import { randomUUID } from "node:crypto";
import { callFn } from "@/db/client";
import { cleanGreeting } from "@/lib/greeting-text";
import { GREETING_GAP_SECONDS, type ScanCount } from "@/lib/types";
import { greetingLane, publishScanCount } from "./ably";
import { scanHash } from "./device";

// ---- scan counter (fix9): distinct devices that opened the vote page ----

type ScanRow = ScanCount & { new?: boolean };

// `isNew` = a device we had not seen yet; only that moves the number, so a reload or a re-open costs
// no Ably message. The route announces it after answering the phone.
export async function recordScan(deviceId: string): Promise<ScanCount & { isNew: boolean }> {
  const r = await callFn<ScanRow>("register_scan", [scanHash(deviceId)]);
  return { count: r.count, at: r.at, isNew: !!r.new };
}

export const readScanCount = () => callFn<ScanCount>("scan_count");

export async function resetScans(): Promise<ScanCount> {
  const r = await callFn<{ ok: boolean } & ScanCount>("reset_scans");
  await publishScanCount({ count: r.count, at: r.at });
  return { count: r.count, at: r.at };
}

// ---- greetings (fix9): phone → this server → Ably → stage. Never stored. ----

export type GreetResult =
  | { result: "sent" }
  | { result: "too_soon"; retry_after: number }
  | { result: "closed" | "empty" | "too_long" | "blocked" | "busy" | "unavailable" };

// A retry of a greeting whose first reply got lost must not use up the sender's 10 s slot a second
// time: remember request ids for a minute (memory only, same instance — best effort by design).
const SEEN_MS = 60_000;
const seen = new Map<string, number>();

function alreadySeen(requestId: string, now: number): boolean {
  for (const [id, at] of seen) if (now - at > SEEN_MS) seen.delete(id);
  return seen.has(requestId);
}

export async function sendGreeting(deviceId: string, requestId: string, raw: unknown): Promise<GreetResult> {
  const now = Date.now();
  if (alreadySeen(requestId, now)) return { result: "sent" };

  const cleaned = cleanGreeting(raw);
  if (!cleaned.ok) return { result: cleaned.reason === "bad_type" ? "empty" : cleaned.reason };
  // Too many waiting for Ably: answer "busy" before the sender's slot is used up
  if (!greetingLane.canAccept()) return { result: "busy" };

  // 1 greeting per device per 10 s, and "is the lobby on screen with the switch on" — both decided
  // by Postgres so every server instance agrees. Not idempotent, so retry only when nothing committed.
  const gate = await callFn<{ result: "ok" | "closed" | "too_soon"; retry_after?: number }>(
    "greeting_gate",
    [scanHash(deviceId), GREETING_GAP_SECONDS],
    "rolled-back",
  );
  if (gate.result === "closed") return { result: "closed" };
  if (gate.result === "too_soon") return { result: "too_soon", retry_after: gate.retry_after ?? GREETING_GAP_SECONDS };

  seen.set(requestId, now);
  const ok = await greetingLane.enqueue({ id: randomUUID(), text: cleaned.text });
  if (!ok) {
    seen.delete(requestId);
    return { result: "unavailable" };
  }
  return { result: "sent" };
}
