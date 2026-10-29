import "server-only";
import { timingSafeEqual } from "node:crypto";

export function isStageKey(k: string | null | undefined): boolean {
  const want = process.env.STAGE_KEY;
  if (!want || !k) return false;
  const a = Buffer.from(k);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}
