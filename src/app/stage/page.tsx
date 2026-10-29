import { EVENT_TITLE } from "@/data/nominees";
import { qrPath } from "./qr";
import { StageClient } from "./stage-client";

const VOTE_URL = process.env.NEXT_PUBLIC_VOTE_URL || "https://vote.example.com";

// vote.example.com/stage?k=<STAGE_KEY> — the key is checked by the API, not here,
// so this page stays a static shell (SPEC 4.1). The QR is drawn at build time from
// NEXT_PUBLIC_VOTE_URL, never from the Host header (SPEC 4.0).
export default function StagePage() {
  const qr = { qr: qrPath(VOTE_URL), urlLabel: VOTE_URL.replace(/^https?:\/\//, ""), eventTitle: EVENT_TITLE };
  return <StageClient qr={qr} />;
}
