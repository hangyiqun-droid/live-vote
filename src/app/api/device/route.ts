import type { NextRequest } from "next/server";
import { json } from "@/lib/server/http";
import { resolveDeviceId, setDeviceCookie } from "@/lib/server/device";

// SPEC 2.1: first visit mints the device id; a later visit with a dropped cookie restores it
// from the phone's localStorage copy. No DB access — nothing about the device is stored.
export async function POST(req: NextRequest) {
  let fromClient: unknown;
  try {
    fromClient = (await req.json())?.device_id;
  } catch {
    fromClient = undefined;
  }
  const device = resolveDeviceId(req, fromClient);
  const res = json({ device_id: device.id });
  if (device.fresh) setDeviceCookie(res, device.id);
  return res;
}
