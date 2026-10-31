import { EVENT_TITLE } from "@/data/nominees";
import { qrPath } from "./qr";
import { StageClient } from "./stage-client";
import type { LinkProps } from "./vote-panel";

const VOTE_URL = process.env.NEXT_PUBLIC_VOTE_URL || "https://vote.example.com";
// Backup address straight to the app's own domain, for when example is down (SPEC 8.2)
const FALLBACK_URL = process.env.NEXT_PUBLIC_VOTE_URL_FALLBACK || "";

const linkFor = (url: string): LinkProps => ({
  qr: qrPath(url),
  urlLabel: url.replace(/^https?:\/\//, ""),
  eventTitle: EVENT_TITLE,
});

// vote.example.com/stage?k=<STAGE_KEY> — the key is checked by the API, not here,
// so this page stays a static shell (SPEC 4.1). Both addresses and their QRs come from
// NEXT_PUBLIC_VOTE_URL(_FALLBACK) at build time, never from the Host header (SPEC 4.0).
export default function StagePage() {
  return <StageClient link={linkFor(VOTE_URL)} linkFallback={FALLBACK_URL ? linkFor(FALLBACK_URL) : null} />;
}
