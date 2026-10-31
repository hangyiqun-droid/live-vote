import {
  pgTable, pgEnum, smallint, text, boolean, bigint, integer, uuid,
  customType, primaryKey, timestamp, bigserial, check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// SPEC 3. Business logic lives in PL/pgSQL functions (drizzle/0001_functions.sql).

const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

export const awardStatus = pgEnum("award_status", ["pending", "open", "closed", "revealed"]);

export const awards = pgTable("awards", {
  id: smallint("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  subtitle: text("subtitle"),
  sortOrder: smallint("sort_order").notNull(),
  status: awardStatus("status").notNull().default("pending"),
  openedAt: timestamp("opened_at", { withTimezone: true }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  revealedAt: timestamp("revealed_at", { withTimezone: true }),
  autoCloseAt: timestamp("auto_close_at", { withTimezone: true }),
  // Bumps on every vote and status change — receivers drop messages older than what they have
  seq: bigint("seq", { mode: "number" }).notNull().default(0),
  // Bumps on reset so phones forget "you voted X" from the previous round
  round: smallint("round").notNull().default(0),
});

// One row: the night itself
export const events = pgTable("events", {
  id: smallint("id").primaryKey().default(1),
  title: text("title").notNull(),
  currentAwardId: smallint("current_award_id").references(() => awards.id), // null = lobby
  hideCounts: boolean("hide_counts").notNull().default(false),
  showHall: boolean("show_hall").notNull().default(false), // MC put the hall of winners on screen (M3)
  qrFallback: boolean("qr_fallback").notNull().default(false), // stage QR points at the backup URL (SPEC 8.2)
  greetingsOn: boolean("greetings_on").notNull().default(true), // phones may send lobby greetings (fix9)
  // Bumps on every status/state change — orders event:event messages
  version: bigint("version", { mode: "number" }).notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [check("events_singleton", sql`${t.id} = 1`)]);

export const nominees = pgTable("nominees", {
  id: smallint("id").primaryKey(),
  nickname: text("nickname").notNull(),
  firstName: text("first_name").notNull(),
  grp: text("grp").notNull(),
  active: boolean("active").notNull().default(true),
}, (t) => [check("nominees_grp", sql`${t.grp} in ('AMBER','AZURE','JADE','RUBY')`)]);

// "This device already voted for this award" — deliberately no nominee, no timestamp
export const ballots = pgTable("ballots", {
  awardId: smallint("award_id").notNull().references(() => awards.id),
  deviceHash: bytea("device_hash").notNull(),
  requestId: uuid("request_id").notNull(),
}, (t) => [primaryKey({ columns: [t.awardId, t.deviceHash] })]);

// Counting board — no device. last_vote_at breaks ties (SPEC 2.2, 5.3) and never leaves Postgres:
// snapshots only carry the resulting order
export const tallies = pgTable("tallies", {
  awardId: smallint("award_id").notNull().references(() => awards.id),
  nomineeId: smallint("nominee_id").notNull().references(() => nominees.id),
  votes: integer("votes").notNull().default(0),
  lastVoteAt: timestamp("last_vote_at", { withTimezone: true }), // when `votes` reached its current value
}, (t) => [primaryKey({ columns: [t.awardId, t.nomineeId] })]);

// fix9: "devices that opened the vote page" for the lobby counter. Its hash is domain-separated
// from ballots.device_hash (HMAC of "scan:<id>"), so the two tables can never be joined. No
// nominee, no message, no IP. last_greet_at only paces greetings (1 per device per 10 s) — the
// greeting text itself is never stored anywhere.
export const scannedDevices = pgTable("scanned_devices", {
  deviceHash: bytea("device_hash").primaryKey(),
  lastGreetAt: timestamp("last_greet_at", { withTimezone: true }),
});

// fix9: one row. `scan_rev` moves every time the set of scanned devices changes, inside the same
// transaction (the row is locked first), so a revision always names exactly one committed count and
// the stage can order counts by it instead of trusting clocks. Also the lock that keeps the counter,
// greetings pacing and reset in one order (lobby_stats → scanned_devices → greeting_requests).
export const lobbyStats = pgTable("lobby_stats", {
  id: smallint("id").primaryKey().default(1),
  scanRev: bigint("scan_rev", { mode: "number" }).notNull().default(0),
}, (t) => [check("lobby_stats_singleton", sql`${t.id} = 1`)]);

// fix9: HMAC of a greeting's random request id + when it passed the gate, kept 60 s. It lets every
// server instance answer a retry with "sent" and enforces the app-wide greetings-per-second ceiling.
// The text of a greeting is never here.
export const greetingRequests = pgTable("greeting_requests", {
  requestHash: bytea("request_hash").primaryKey(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

// Admin actions only, never votes
export const adminLog = pgTable("admin_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  action: text("action").notNull(),
  awardId: smallint("award_id"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});
