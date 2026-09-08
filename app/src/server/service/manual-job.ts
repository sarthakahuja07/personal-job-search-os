/**
 * Add a job the crawler did not find, from nothing but its link.
 *
 * The crawler covers 28 companies; a referral conversation covers whatever someone sends you.
 * Without this, a link from a friend has to be tracked outside the app entirely, which is how a
 * pipeline quietly stops reflecting reality.
 *
 * Once created, such a job is an ordinary job: it appears on the board, it is scored for fit, and
 * it becomes eligible for reminders. Nothing downstream needs to know it arrived by hand.
 */

import { and, eq } from "drizzle-orm";

import type { Db } from "@/db";
import { companies, jobs, settings } from "@/db/schema";
import { scoreFit } from "@/server/domain/fit";
import { DEFAULT_MATCH_RULES, matchJob } from "@/server/domain/matching";
import { normalizeJobUrl } from "@/server/domain/url";

export type ManualJobInput = {
  jobUrl: string;
  title: string;
  /** An existing company, or a name to create one under. */
  companyId?: string;
  companyName?: string;
  location?: string;
};

export type ManualJobResult =
  | { ok: true; jobId: string; companyId: string; created: boolean }
  | { ok: false; error: string };

/**
 * Identity for a hand-added job.
 *
 * ADR 005 forbids synthesising `external_job_id` — but that rule exists because a *crawled* job
 * always has a real source id, and inventing one (from a title, say) breaks dedup the moment the
 * title changes. A pasted link has no source id to use, so the honest identity is the link
 * itself: stable, unique per posting, and derived from the source rather than from content that
 * can be edited. The `manual:` prefix keeps it obvious that this is not a vendor id.
 */
export function manualExternalId(jobUrl: string): string {
  return `manual:${normalizeJobUrl(jobUrl)}`;
}

/** Best-effort company guess from a job link, so the common case needs no dropdown. */
export function guessCompanyFromUrl(
  jobUrl: string,
  known: { id: string; name: string; careersUrl: string | null; websiteUrl: string | null }[],
): string | null {
  let host: string;
  try {
    host = new URL(jobUrl).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }

  for (const c of known) {
    for (const candidate of [c.careersUrl, c.websiteUrl]) {
      if (!candidate) continue;
      try {
        const h = new URL(candidate).hostname.toLowerCase().replace(/^www\./, "");
        if (h === host) return c.id;
      } catch {
        // A malformed stored URL should never break adding a job.
      }
    }
    // ATS links carry the company in the path (boards.greenhouse.io/postman), not the host.
    const slug = c.name.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (slug.length >= 4 && jobUrl.toLowerCase().replace(/[^a-z0-9]/g, "").includes(slug)) {
      return c.id;
    }
  }
  return null;
}

export async function addManualJob(
  db: Db,
  input: ManualJobInput,
): Promise<ManualJobResult> {
  const jobUrl = input.jobUrl.trim();
  const title = input.title.trim();
  if (!title) return { ok: false, error: "A title is required." };

  let parsed: URL;
  try {
    parsed = new URL(jobUrl);
  } catch {
    return { ok: false, error: "That does not look like a URL." };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, error: "Only http and https links can be added." };
  }

  // Resolve the company: an existing one, or a new manual row for a company we do not track.
  let companyId = input.companyId?.trim() || "";
  if (!companyId) {
    const name = (input.companyName ?? "").trim();
    if (!name) return { ok: false, error: "Pick a company, or type a new one." };

    const existing = await db
      .select({ id: companies.id })
      .from(companies)
      .where(eq(companies.name, name))
      .limit(1);

    if (existing.length) {
      companyId = existing[0].id;
    } else {
      companyId = crypto.randomUUID();
      // Manual: there is no feed behind it, and guessing one would create a source that silently
      // returns nothing forever.
      await db.insert(companies).values({
        id: companyId,
        name,
        careersUrl: `${parsed.origin}/`,
        sourceType: "manual",
        sourceTier: 6,
        sourceConfig: {},
        active: true,
      });
    }
  }

  const externalJobId = manualExternalId(jobUrl);
  const existingJob = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.companyId, companyId), eq(jobs.externalJobId, externalJobId)))
    .limit(1);

  if (existingJob.length) {
    return { ok: true, jobId: existingJob[0].id, companyId, created: false };
  }

  const rulesRows = await db.select({ matchRules: settings.matchRules }).from(settings).limit(1);
  const rules = rulesRows[0]?.matchRules ?? DEFAULT_MATCH_RULES;
  const location = input.location?.trim() || null;

  const match = matchJob({ title, location, description: null }, rules);
  const fit = scoreFit({ title, description: null, locationPriority: match.locationPriority });

  const jobId = crypto.randomUUID();
  await db.insert(jobs).values({
    id: jobId,
    companyId,
    externalJobId,
    title,
    location,
    jobUrl,
    normalizedJobUrl: normalizeJobUrl(jobUrl),
    source: "manual",
    // A job you added by hand is one you have already decided is worth tracking, so it is
    // relevant regardless of what the title rules make of it. The match verdict is still stored
    // and shown, so the disagreement stays visible rather than hidden.
    isRelevant: true,
    matchScore: match.score,
    matchReason: match.isRelevant
      ? match.reason
      : `Added by hand · rules would have said: ${match.reason}`,
    locationPriority: match.locationPriority,
    fitScore: fit.score,
    fitBand: fit.band,
    fitSignals: fit.signals,
    fitTitleOnly: fit.titleOnly,
    discoveredAt: new Date(),
  });

  return { ok: true, jobId, companyId, created: true };
}
