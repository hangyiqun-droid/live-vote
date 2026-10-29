import { StageClient } from "./stage-client";

// vote.example.com/stage?k=<STAGE_KEY> — the key is checked by the API, not here,
// so this page stays a static shell (SPEC 4.1)
export default function StagePage() {
  return <StageClient />;
}
