// Shapes produced by the Postgres functions in drizzle/0001_functions.sql

export type AwardStatus = "pending" | "open" | "closed" | "revealed";

export type AwardState = {
  id: number;
  slug: string;
  title: string;
  subtitle: string | null;
  status: AwardStatus;
  auto_close_at: string | null;
  round: number;
};

// event:event — no counts, safe for phones
export type EventState = {
  version: number;
  title: string;
  current_award_id: number | null;
  hide_counts: boolean;
  show_hall: boolean; // MC put the hall of winners on screen
  qr_fallback: boolean; // stage QR shows the backup URL (SPEC 8.2)
  server_now: string;
  awards: AwardState[];
};

// event:tally — stage only
export type TallySnapshot = {
  award_id: number;
  seq: number;
  status: AwardStatus;
  round: number;
  auto_close_at: string | null;
  total: number;
  counts: [number, number][];
  order: number[]; // nominee ids, final ranking incl. tie-break (SPEC 5.3) — the times stay in Postgres
};

// MC page: every award's tally plus the ballot/tally cross-check (verify_tallies)
export type AdminTally = TallySnapshot & { verified: boolean };
export type AdminOverview = { state: EventState; tallies: AdminTally[] };

export type VoteResult =
  | { result: "counted"; snapshot?: TallySnapshot; replay?: boolean }
  | { result: "already_voted" }
  | { result: "not_open"; status: AwardStatus | null }
  | { result: "invalid_nominee" };

export const CHANNEL_EVENT = "event:event";
export const CHANNEL_TALLY = "event:tally";
