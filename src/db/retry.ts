// Which DB errors are worth one more try (preview logs showed Postgres "out of memory"
// on a small dev compute and one "deadlock detected" — both roll the statement back).

// Postgres reported the error itself → the statement was rolled back, nothing committed
const ROLLED_BACK_SQLSTATE = new Set([
  "40001", // serialization_failure
  "40P01", // deadlock_detected
  "53000", // insufficient_resources
  "53200", // out_of_memory
  "53300", // too_many_connections
  "55P03", // lock_not_available
  "57P01", // admin_shutdown (compute restart)
  "57P02", // crash_shutdown
  "57P03", // cannot_connect_now (compute waking up)
  "08000", // connection_exception
  "08001", // sqlclient_unable_to_establish_sqlconnection
  "08004", // sqlserver_rejected_establishment_of_sqlconnection
  "08006", // connection_failure
  "XX000", // pgbouncer / Neon proxy "internal" errors (e.g. "server conn crashed?")
]);

// The socket broke: if the query was already sent, we cannot know whether it committed
const SOCKET_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE", "ENOTFOUND", "EAI_AGAIN", "ENETUNREACH"]);
const SOCKET_MESSAGES = /connection terminated|timeout exceeded when trying to connect|connection timeout|client has encountered a connection error|socket hang up/i;

export type RetryPolicy = "always" | "rolled-back";

const codeOf = (e: unknown) => (e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : "");
const messageOf = (e: unknown) => (e instanceof Error ? e.message : "");

export function isConnectionError(e: unknown): boolean {
  return SOCKET_CODES.has(codeOf(e)) || SOCKET_MESSAGES.test(messageOf(e));
}

// phase "connect": we never got a client, so nothing ran — always safe to retry
export function isRetryable(e: unknown, phase: "connect" | "query", policy: RetryPolicy): boolean {
  if (ROLLED_BACK_SQLSTATE.has(codeOf(e))) return true;
  if (!isConnectionError(e)) return false;
  return phase === "connect" || policy === "always";
}

// 100 → 250 → 500 ms (+ up to 50% jitter so instances don't retry in lock-step); 3 retries ≈ 1.3 s max
export function retryDelay(attempt: number, random = Math.random): number {
  const base = [100, 250, 500][Math.min(attempt, 3) - 1];
  return Math.round(base * (1 + random() * 0.5));
}
