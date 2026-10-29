import type { NextRequest } from "next/server";
import { callFn } from "@/db/client";
import { publishTally } from "@/lib/server/ably";
import { deviceHash, isUuid, resolveDeviceId, setDeviceCookie } from "@/lib/server/device";
import { json, serverError } from "@/lib/server/http";
import { allow, clientIp } from "@/lib/server/rate-limit";
import type { VoteResult } from "@/lib/types";

// Loose on purpose: the whole room shares one Wi-Fi IP
const PER_IP_PER_MINUTE = 600;

function smallInt(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v > 0 && v < 1000 ? v : null;
}

// SPEC 2.3. Never log the body — only the outcome and latency (SPEC 2.2).
export async function POST(req: NextRequest) {
  const started = performance.now();
  if (!allow(`vote:${clientIp(req.headers)}`, PER_IP_PER_MINUTE)) {
    return json({ result: "rate_limited" }, 429);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ result: "bad_request" }, 400);
  }
  const awardId = smallInt(body.award_id);
  const nomineeId = smallInt(body.nominee_id);
  const requestId = body.request_id;
  if (!awardId || !nomineeId || !isUuid(requestId)) {
    return json({ result: "bad_request" }, 400);
  }

  const device = resolveDeviceId(req, body.device_id);
  try {
    const r = await callFn<VoteResult>("cast_vote", [awardId, nomineeId, deviceHash(device.id), requestId]);
    let published: boolean | undefined;
    if (r.result === "counted" && r.snapshot) published = await publishTally(r.snapshot);

    const res = json({
      result: r.result,
      ...(r.result === "not_open" ? { status: r.status } : {}),
      device_id: device.id,
    });
    if (device.fresh) setDeviceCookie(res, device.id);
    console.log(
      `[vote] ${r.result}${published === false ? " publish_failed" : ""} ${Math.round(performance.now() - started)}ms`,
    );
    return res;
  } catch (e) {
    return serverError("vote", e);
  }
}
