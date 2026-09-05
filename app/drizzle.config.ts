import type { Config } from "drizzle-kit";

// Generates SQL migrations from src/db/schema.ts.
// Migrations are applied with `wrangler d1 migrations apply`, never by drizzle-kit push --
// a bad migration against the only copy of the data is not worth the convenience.
export default {
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "sqlite",
} satisfies Config;
