import { EVENT_TITLE } from "@/data/nominees";
import { qrPath } from "./qr";
import type { QrProps } from "./qr-panel";
import { StageClient } from "./stage-client";

const VOTE_URL = process.env.NEXT_PUBLIC_VOTE_URL || "https://vote.example.com";
// Backup QR straight to the app's own domain, for when example is down (SPEC 8.2)
const FALLBACK_URL = process.env.NEXT_PUBLIC_VOTE_URL_FALLBACK || "";

const qrFor = (url: string): QrProps => ({
  qr: qrPath(url),
  urlLabel: url.replace(/^https?:\/\//, ""),
  eventTitle: EVENT_TITLE,
});

// vote.example.com/stage?k=<STAGE_KEY> — the key is checked by the API, not here,
// so this page stays a static shell (SPEC 4.1). Both QRs are drawn at build time from
// NEXT_PUBLIC_VOTE_URL(_FALLBACK), never from the Host header (SPEC 4.0).
export default function StagePage() {
  return <StageClient qr={qrFor(VOTE_URL)} qrFallback={FALLBACK_URL ? qrFor(FALLBACK_URL) : null} />;
}
