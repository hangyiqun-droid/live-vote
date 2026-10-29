import "server-only";
import { attachDatabasePool } from "@vercel/functions";
import { Pool } from "pg";
import { pgUrl } from "./pg-url";

// Fluid Compute: one pooled TCP pool per instance (SPEC 1.1 #8)
const globalForPool = globalThis as unknown as { eventPool?: Pool };

export const pool =
  globalForPool.eventPool ??
  new Pool({ connectionString: pgUrl(process.env.DATABASE_URL), max: 5, idleTimeoutMillis: 10_000 });

if (!globalForPool.eventPool) {
  globalForPool.eventPool = pool;
  attachDatabasePool(pool);
}

// Calls one SQL function returning jsonb, e.g. callFn("cast_vote", [1, 2, hash, id])
export async function callFn<T>(fn: string, args: unknown[] = []): Promise<T> {
  const params = args.map((_, i) => `$${i + 1}`).join(", ");
  const { rows } = await pool.query(`select ${fn}(${params}) as r`, args);
  return rows[0].r as T;
}
