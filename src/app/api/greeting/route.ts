import type { NextRequest } from "next/server";
import { isUuid, resolveDeviceId, setDeviceCookie } from "@/lib/server/device";
import { json, serverError } from "@/lib/server/http";
import { sendGreeting } from "@/lib/server/lobby";
import { allow, clientIp } from "@/lib/server/rate-limit";

// Loose per-IP guard against a script; the real pacing (1 per device per 10 s) is in Postgres.
const GREETING_PER_IP_PER_MINUTE = 600;

// fix9: a greeting from a phone. The text goes server → Ably → stage and is never stored or logged
// (only the outcome is). The sender is anonymous: the device id is used for pacing and nothing else.
export async function POST(req: NextRequest) {
  if (!allow(`greet:${clientIp(req.headers)}`, GREETING_PER_IP_PER_MINUTE)) {
    return json({ result: "busy" }, 429);
  }
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ result: "bad_request" }, 400);
  }
  if (!isUuid(body.request_id)) return json({ result: "bad_request" }, 400);

  const device = resolveDeviceId(req, body.device_id);
  try {
    const r = await sendGreeting(device.id, body.request_id.toLowerCase(), body.text);
    console.log(`[greeting] ${r.result}`);
    const res = json(r);
    if (device.fresh) setDeviceCookie(res, device.id);
    return res;
  } catch (e) {
    return serverError("greeting", e);
  }
}
