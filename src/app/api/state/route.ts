import { connection } from "next/server";
import { json, serverError } from "@/lib/server/http";
import { expireAndRead } from "@/lib/server/state";

// Award statuses for phones — never any counts
export async function GET() {
  await connection();
  try {
    return json(await expireAndRead());
  } catch (e) {
    return serverError("state", e);
  }
}
