import type { Metadata } from "next";
import { VERSION } from "@/version";
import { AdminClient } from "./admin-client";

export const metadata: Metadata = { title: "พิธีกร · โหวตรางวัล", robots: { index: false, follow: false } };

// vote.example.com/admin — static shell; the session cookie is checked by every API call (SPEC 4.3)
export default function AdminPage() {
  return <AdminClient version={VERSION} hasFallback={!!process.env.NEXT_PUBLIC_VOTE_URL_FALLBACK} />;
}
