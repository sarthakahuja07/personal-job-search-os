import { eq } from "drizzle-orm";

import { getDb } from "@/db";
import { companies, settings } from "@/db/schema";
import { requireIngestToken } from "@/server/auth";
import { DEFAULT_MATCH_RULES } from "@/server/domain/matching";

/**
 * GET /api/crawler/bootstrap
 *
 * Everything the crawler needs for a run, in one request: which companies to crawl, how to
 * reach each one, and the current match rules.
 *
 * The rules are served rather than duplicated in Python so `settings.match_rules` stays the
 * single source of truth. The crawler re-implements only regex evaluation for its cheap
 * title pre-filter, never the rule set itself.
 */
export async function GET(request: Request): Promise<Response> {
  const auth = requireIngestToken(request);
  if (!auth.ok) return auth.response;

  const db = getDb();

  const rows = await db
    .select({
      id: companies.id,
      name: companies.name,
      sourceType: companies.sourceType,
      sourceTier: companies.sourceTier,
      sourceConfig: companies.sourceConfig,
      careersUrl: companies.careersUrl,
      allowZeroResults: companies.allowZeroResults,
      etag: companies.etag,
      lastModified: companies.lastModified,
      lastContentHash: companies.lastContentHash,
    })
    .from(companies)
    .where(eq(companies.active, true));

  const settingsRows = await db
    .select({ matchRules: settings.matchRules })
    .from(settings)
    .limit(1);

  // Only companies with an automated adapter are worth dispatching. Tier 6 is a real state --
  // it means "Sarthak checks this by hand" -- not a failure, so it is filtered here rather
  // than left to fail noisily in the orchestrator.
  const crawlable = rows.filter((r) => r.sourceType !== "manual");

  return Response.json({
    companies: crawlable.map((r) => ({
      id: r.id,
      name: r.name,
      source_type: r.sourceType,
      source_tier: r.sourceTier,
      source_config: r.sourceConfig,
      careers_url: r.careersUrl,
      allow_zero_results: r.allowZeroResults,
      etag: r.etag,
      last_modified: r.lastModified,
      last_content_hash: r.lastContentHash,
    })),
    match_rules: settingsRows[0]?.matchRules ?? DEFAULT_MATCH_RULES,
    manual_count: rows.length - crawlable.length,
  });
}
