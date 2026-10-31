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
  greetings_on: boolean; // MC switch: phones may send lobby greetings, the stage shows them (fix9)
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

// event:lobby — stage only (fix9). Not the vote channel, so a rush of greetings or scans can never
// eat the tally channel's 50 msg/s. `at` is Postgres' clock in ms: the stage ignores older counts.
export const CHANNEL_LOBBY = "event:lobby";
export type ScanCount = { count: number; at: number };
export type Greeting = { id: string; text: string };
// One Ably message carries a whole batch of greetings
export type GreetingBatch = { items: Greeting[] };

// Greeting limits, shared by the phone box and the server check (the server is the one that counts)
export const GREETING_MAX_CHARS = 60;
export const GREETING_GAP_SECONDS = 10;
