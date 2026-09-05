/**
 * Database access point.
 *
 * This is the only module that reaches for the D1 binding. Repositories import `getDb()` from
 * here; nothing else in the application touches Cloudflare's context directly. Keeping the
 * binding confined to one file is what makes a future adapter migration (see ADR 009) a
 * build-layer change rather than an application-wide one.
 *
 * A note on query budget: D1 permits 50 queries per Worker invocation. That is a hard ceiling,
 * not a guideline -- it forbids N+1 patterns in request handlers. Repositories must use joins or
 * batched `IN` lookups. See docs/database.md.
 */

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";

import * as schema from "./schema";

export type Db = DrizzleD1Database<typeof schema>;

/**
 * Synchronous accessor, for use inside a request (server components, route handlers,
 * server actions) where the Cloudflare context is already established.
 */
export function getDb(): Db {
  const { env } = getCloudflareContext();
  return drizzle(env.DB, { schema, logger: false });
}

/**
 * Async accessor, required in contexts evaluated outside a request -- notably statically
 * rendered pages. Prefer `getDb()` inside request handlers.
 */
export async function getDbAsync(): Promise<Db> {
  const { env } = await getCloudflareContext({ async: true });
  return drizzle(env.DB, { schema, logger: false });
}

export { schema };
