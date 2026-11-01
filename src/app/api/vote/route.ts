import { after, type NextRequest } from "next/server";
import { callFn } from "@/db/client";
import { publishTally } from "@/lib/server/ably";
import { deviceHash, isUuid, resolveDeviceId, setDeviceCookie } from "@/lib/server/device";
import { json, serverError } from "@/lib/server/http";
import { allow, clientIp } from "@/lib/server/rate-limit";
import type { VoteResult } from "@/lib/types";

// Loose on purpose: the whole room shares one Wi-Fi IP. 150 phones × (vote + a few
// retries) stays far below this; it only stops a runaway script. The DB primary key is the guard.
const VOTE_PER_IP_PER_MINUTE = 1200;

function smallInt(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v > 0 && v < 1000 ? v : null;
}

// Never log the body — only the outcome and latency.
export async function POST(req: NextRequest) {
  const started = performance.now();
  if (!allow(`vote:${clientIp(req.headers)}`, VOTE_PER_IP_PER_MINUTE)) {
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
    const res = json({
      result: r.result,
      ...(r.result === "not_open" ? { status: r.status } : {}),
      device_id: device.id,
    });
    if (device.fresh) setDeviceCookie(res, device.id);
    const ms = Math.round(performance.now() - started);
    const snapshot = r.result === "counted" ? r.snapshot : undefined;
    if (snapshot) {
      // the vote is safe in Postgres, so the phone gets its answer now; the announcement keeps
      // running after the response (publishTally coalesces a rush into the newest snapshot).
      after(async () => {
        const published = await publishTally(snapshot);
        console.log(`[vote] counted${published ? "" : " publish_failed"} ${ms}ms`);
      });
    } else {
      console.log(`[vote] ${r.result} ${ms}ms`);
    }
    return res;
  } catch (e) {
    return serverError("vote", e);
  }
}
