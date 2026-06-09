import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

/** API unificada (returning, transações) — compatível com node-postgres e Neon em runtime. */
export type Db = NodePgDatabase<typeof schema>;

let cached: Db | undefined;

function useNodePostgres(url: string): boolean {
  const driver = process.env.DATABASE_DRIVER?.trim().toLowerCase();
  if (driver === "pg" || driver === "node-postgres") return true;
  if (driver === "neon") return false;
  return !url.includes("neon.tech");
}

export function getDb(): Db {
  if (cached) return cached;

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is required");
  }

  if (useNodePostgres(url)) {
    const pool = new Pool({ connectionString: url });
    cached = drizzlePg(pool, { schema });
    return cached;
  }

  cached = drizzleNeon(neon(url), { schema }) as unknown as Db;
  return cached;
}
