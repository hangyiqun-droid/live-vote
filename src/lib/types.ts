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

// lv:event — no counts, safe for phones
export type EventState = {
  version: number;
  title: string;
  current_award_id: number | null;
  hide_counts: boolean;
  show_hall: boolean; // MC put the hall of winners on screen
  qr_fallback: boolean; // stage QR shows the backup URL
  greetings_on: boolean; // MC switch: phones may send lobby greetings, the stage shows them
  demo?: boolean; // DEMO_MODE deployment: screens show a "sample data" tag and greetings stay off
  server_now: string;
  awards: AwardState[];
};

// lv:tally — stage only
export type TallySnapshot = {
  award_id: number;
  seq: number;
  status: AwardStatus;
  round: number;
  auto_close_at: string | null;
  total: number;
  counts: [number, number][];
  order: number[]; // nominee ids, final ranking incl. tie-break — the times stay in Postgres
};

// MC page: every award's tally plus the ballot/tally cross-check (verify_tallies)
export type AdminTally = TallySnapshot & { verified: boolean };
export type AdminOverview = { state: EventState; tallies: AdminTally[] };

export type VoteResult =
  | { result: "counted"; snapshot?: TallySnapshot; replay?: boolean }
  | { result: "already_voted" }
  | { result: "not_open"; status: AwardStatus | null }
  | { result: "invalid_nominee" };

export const CHANNEL_EVENT = "lv:event";
export const CHANNEL_TALLY = "lv:tally";

// lv:lobby — stage only. Not the vote channel, so a rush of greetings or scans can never
// eat the tally channel's 50 msg/s. `rev` is the committed revision the count belongs to (lobby_stats.scan_rev):
// the stage keeps the highest one, so the screen always ends on the number the database holds.
export const CHANNEL_LOBBY = "lv:lobby";
export type ScanCount = { count: number; rev: number };
export type Greeting = { id: string; text: string };
// One Ably message carries a whole batch of greetings
export type GreetingBatch = { items: Greeting[] };

// Greeting limits, shared by the phone box and the server check (the server is the one that counts)
export const GREETING_MAX_CHARS = 60;
export const GREETING_GAP_SECONDS = 10;
export const GREETING_MAX_PER_SECOND = 3; // app-wide, enforced in Postgres (greeting_gate)
