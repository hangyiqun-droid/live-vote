import { clearAdminCookie } from "@/lib/server/admin-session";
import { json } from "@/lib/server/http";

export async function POST() {
  const res = json({ ok: true });
  clearAdminCookie(res);
  return res;
}
