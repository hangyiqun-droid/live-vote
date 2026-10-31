import "server-only";
import { createHmac, randomUUID } from "node:crypto";
import { callFn } from "@/db/client";
import { isMissingSchema } from "@/db/schema-missing";
import { cleanGreeting } from "@/lib/greeting-text";
import { GREETING_GAP_SECONDS, GREETING_MAX_PER_SECOND, type ScanCount } from "@/lib/types";
import { greetingLane, publishScanCount } from "./ably";
import { scanHash } from "./device";

// ---- scan counter (fix9): distinct devices that opened the vote page ----

type ScanRow = ScanCount & { new?: boolean };

// `isNew` = a device we had not seen yet; only that moves the number, so a reload or a re-open costs
// no Ably message. The route announces it after answering the phone. `null` = migration 0006 is not
// in this database yet (the counter simply does not exist).
export async function recordScan(deviceId: string): Promise<(ScanCount & { isNew: boolean }) | null> {
  try {
    const r = await callFn<ScanRow>("register_scan", [scanHash(deviceId)]);
    return { count: r.count, rev: r.rev, isNew: !!r.new };
  } catch (e) {
    if (isMissingSchema(e)) return null;
    throw e;
  }
}

export async function readScanCount(): Promise<ScanCount | null> {
  try {
    return await callFn<ScanCount>("scan_count");
  } catch (e) {
    if (isMissingSchema(e)) return null;
    throw e;
  }
}

export async function resetScans(): Promise<ScanCount> {
  const r = await callFn<{ ok: boolean } & ScanCount>("reset_scans");
  await publishScanCount({ count: r.count, rev: r.rev });
  return { count: r.count, rev: r.rev };
}

// ---- greetings (fix9): phone → this server → Ably → stage. Never stored. ----

export type GreetResult =
  | { result: "sent" }
  | { result: "too_soon"; retry_after: number }
  | { result: "busy"; retry_after?: number }
  | { result: "closed" | "empty" | "too_long" | "blocked" | "unavailable" };

// HMAC of the random request id (same salt, own domain): kept 60 s by Postgres so a retry that lands
// on another server instance is still answered "sent" instead of publishing twice. Never the text.
const requestHash = (id: string) => {
  const salt = process.env.DEVICE_SALT;
  if (!salt) throw new Error("DEVICE_SALT is not set");
  return createHmac("sha256", salt).update(`greet:${id}`).digest();
};

type Gate = { result: "ok" | "replay" | "closed" | "busy" | "too_soon"; retry_after?: number; scan?: ScanCount };

export async function sendGreeting(deviceId: string, requestId: string, raw: unknown): Promise<GreetResult> {
  const cleaned = cleanGreeting(raw);
  if (!cleaned.ok) return { result: cleaned.reason === "bad_type" ? "empty" : cleaned.reason };
  // This instance's own queue is full: answer before the sender's slot is used up
  if (!greetingLane.canAccept()) return { result: "busy", retry_after: 2 };

  // Decided by Postgres so every server instance agrees: switch on + lobby on screen, this request
  // not seen before, ≤ 3 greetings a second app-wide, 1 per device per 10 s. Not idempotent, so a DB
  // error is retried only when nothing committed. Migration 0006 missing = greetings are off.
  const dev = scanHash(deviceId);
  const req = requestHash(requestId);
  let gate: Gate;
  try {
    gate = await callFn<Gate>("greeting_gate", [dev, GREETING_GAP_SECONDS, req, GREETING_MAX_PER_SECOND], "rolled-back");
  } catch (e) {
    if (isMissingSchema(e)) return { result: "closed" };
    throw e;
  }
  if (gate.result === "closed") return { result: "closed" };
  if (gate.result === "replay") return { result: "sent" };
  if (gate.result === "busy") return { result: "busy", retry_after: gate.retry_after ?? 1 };
  if (gate.result === "too_soon") return { result: "too_soon", retry_after: gate.retry_after ?? GREETING_GAP_SECONDS };

  // A device the gate had never seen is a new scan too
  if (gate.scan) void publishScanCount(gate.scan);

  const outcome = await greetingLane.enqueue({ id: randomUUID(), text: cleaned.text });
  if (outcome === "sent") return { result: "sent" };
  // Nothing was shown: give the sender their slot (and the request id) back so "try again" works
  await callFn("greeting_release", [dev, req]).catch(() => undefined);
  return { result: outcome === "closed" ? "closed" : outcome === "busy" ? "busy" : "unavailable" };
}
