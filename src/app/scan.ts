import { withBase } from "@/lib/base-path";
import { fetchWithTimeout } from "@/lib/uuid";

// fix9: tell the server this phone opened the vote page, so the lobby counter can say "scanned N".
// Fire and forget: a failure never shows on the phone, it just tries again a few seconds later.
export async function registerScan(deviceId: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetchWithTimeout(withBase("/api/scan"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ device_id: deviceId }),
      });
      if (r.ok || r.status === 429) return;
    } catch {
      // network hiccup — retry below
    }
    await new Promise((res) => setTimeout(res, 3_000 * (attempt + 1)));
  }
}
