import { EVENT_TITLE } from "@/data/nominees";
import { BASE_PATH } from "@/lib/base-path";
import { qrPath } from "./qr";
import { StageClient } from "./stage-client";
import type { LinkProps } from "./vote-panel";

const VOTE_URL = process.env.NEXT_PUBLIC_VOTE_URL || `http://localhost:3000${BASE_PATH}`;
// Optional second address (the app's own domain) for the MC to switch the stage QR to if the main one fails
const FALLBACK_URL = process.env.NEXT_PUBLIC_VOTE_URL_FALLBACK || "";

const linkFor = (url: string): LinkProps => ({
  qr: qrPath(url),
  urlLabel: url.replace(/^https?:\/\//, ""),
  eventTitle: EVENT_TITLE,
});

// /stage?k=<STAGE_KEY> — the key is checked by the API, not here, so this page stays a static
// shell. Both addresses and their QRs come from NEXT_PUBLIC_VOTE_URL(_FALLBACK) at build time,
// never from the Host header.
export default function StagePage() {
  return <StageClient link={linkFor(VOTE_URL)} linkFallback={FALLBACK_URL ? linkFor(FALLBACK_URL) : null} />;
}
