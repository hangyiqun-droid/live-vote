import { after, type NextRequest } from "next/server";
import { publishScanCount } from "@/lib/server/ably";
import { resolveDeviceId, setDeviceCookie } from "@/lib/server/device";
import { json, serverError } from "@/lib/server/http";
import { recordScan } from "@/lib/server/lobby";
import { allow, clientIp } from "@/lib/server/rate-limit";

// Loose like the vote limit: the whole room shares one Wi-Fi IP
const SCAN_PER_IP_PER_MINUTE = 1200;

// fix9: a phone opened the vote page → the lobby counter ("scanned N people"). The body is only the
// phone's own device id; nothing else is read, kept or logged.
export async function POST(req: NextRequest) {
  if (!allow(`scan:${clientIp(req.headers)}`, SCAN_PER_IP_PER_MINUTE)) {
    return json({ result: "rate_limited" }, 429);
  }
  let fromClient: unknown;
  try {
    fromClient = (await req.json())?.device_id;
  } catch {
    fromClient = undefined;
  }
  const device = resolveDeviceId(req, fromClient);
  try {
    const scan = await recordScan(device.id);
    if (scan?.isNew) after(() => publishScanCount({ count: scan.count, rev: scan.rev }));
    // scan === null: the database has no lobby counter yet (migration 0006) — nothing to count, nothing to fail
    const res = json({ result: scan ? "ok" : "unavailable", device_id: device.id });
    if (device.fresh) setDeviceCookie(res, device.id);
    return res;
  } catch (e) {
    return serverError("scan", e);
  }
}
