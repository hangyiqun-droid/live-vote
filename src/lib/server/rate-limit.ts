import "server-only";

// Loose per-IP limiter in memory only (never stored). Everyone at the venue shares one Wi-Fi IP,
// so this only stops a script hammering the API — the DB primary key is the real guard.
const WINDOW_MS = 60_000;
const hits = new Map<string, { n: number; reset: number }>();

export function allow(key: string, limit: number): boolean {
  const now = Date.now();
  const h = hits.get(key);
  if (!h || now > h.reset) {
    if (hits.size > 5_000) hits.clear();
    hits.set(key, { n: 1, reset: now + WINDOW_MS });
    return true;
  }
  h.n += 1;
  return h.n <= limit;
}

export function clientIp(headers: Headers): string {
  return headers.get("x-real-ip") ?? headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}
