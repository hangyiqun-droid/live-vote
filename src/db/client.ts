import "server-only";
import { attachDatabasePool } from "@vercel/functions";
import { Pool } from "pg";
import { pgUrl } from "./pg-url";
import { isConnectionError, isRetryable, retryDelay, type RetryPolicy } from "./retry";

// Fluid Compute: one pooled TCP pool per instance
const globalForPool = globalThis as unknown as { lvPool?: Pool };

export const pool =
  globalForPool.lvPool ??
  new Pool({
    connectionString: pgUrl(process.env.DATABASE_URL),
    max: 5,
    idleTimeoutMillis: 10_000,
    // A request never waits forever for a socket: fail fast, then callFn retries
    connectionTimeoutMillis: 5_000,
    keepAlive: true,
  });

if (!globalForPool.lvPool) {
  globalForPool.lvPool = pool;
  attachDatabasePool(pool);
  // An idle client dropped by Neon (pooler restart, compute scaling) emits "error" on the pool;
  // unhandled, that event would crash the whole instance and every request in flight on it.
  pool.on("error", (e) => console.error("[db] idle client error", e.message));
}

const ATTEMPTS = 4;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Calls one SQL function returning jsonb, e.g. callFn("cast_vote", [1, 2, hash, id]).
// Each call is one autocommit statement, so a transient DB error (deadlock, out of memory,
// too many connections, a dropped socket) is retried before the route answers 503.
// "always" is for functions that are safe to run twice (cast_vote keys on request_id, status
// changes answer "unchanged"); "rolled-back" only retries when Postgres says nothing committed.
export async function callFn<T>(fn: string, args: unknown[] = [], policy: RetryPolicy = "always"): Promise<T> {
  const params = args.map((_, i) => `$${i + 1}`).join(", ");
  for (let attempt = 1; ; attempt++) {
    let phase: "connect" | "query" = "connect";
    try {
      const client = await pool.connect();
      phase = "query";
      try {
        const { rows } = await client.query(`select ${fn}(${params}) as r`, args);
        client.release();
        return rows[0].r as T;
      } catch (e) {
        // A broken socket must not go back to the pool
        client.release(isConnectionError(e) ? (e as Error) : undefined);
        throw e;
      }
    } catch (e) {
      if (attempt >= ATTEMPTS || !isRetryable(e, phase, policy)) throw e;
      console.warn(`[db] ${fn} retry ${attempt}: ${e instanceof Error ? e.message : "unknown error"}`);
      await sleep(retryDelay(attempt));
    }
  }
}
