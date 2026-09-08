/**
 * Add a job the crawler did not find, from nothing but its link.
 *
 * The crawler covers 29 companies; a referral conversation covers whatever someone sends you.
 * Without this, a link from a friend has to be tracked outside the app entirely, which is how a
 * pipeline quietly stops reflecting reality.
 *
 * Once created, such a job is an ordinary job: it appears on the board, it is scored for fit, and
 * it becomes eligible for reminders. Nothing downstream needs to know it arrived by hand.
 *
 * The important behaviour is what happens when the job is *already* known. Pasting a link the
 * crawler already found must attach to that job rather than create a second copy of it —
 * otherwise the board grows duplicates, the reminder list counts the same role twice, and
 * "already applied" stops being answerable.
 */

import { and, eq, like } from "drizzle-orm";

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

/** What actually happened, so the UI can say so rather than silently succeeding. */
export type ManualJobOutcome = "created" | "matched_existing" | "already_tracked";

export type ManualJobResult =
  | {
      ok: true;
      jobId: string;
      companyId: string;
      outcome: ManualJobOutcome;
      title: string;
      companyName: string;
    }
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


/**
 * A locale-insensitive key for one posting, used ONLY when adding a job by hand.
 *
 * IBM serves the same requisition at /en_IN/... and /en_US/..., so pasting the link you happened
 * to open creates a second copy of a job the crawler already has. Stripping the locale segment
 * fixes that — but it deliberately does not touch `normalizeJobUrl`, which is the crawler's
 * identity function and shared with Python. Loosening *that* is how 869 of Databricks' 870 jobs
 * once collapsed onto one URL, and a duplicate you can see beats a board that silently lost
 * everything.
 *
 * So the relaxation lives here: a second, softer lookup on the manual path only, where the cost
 * of a false match is one job attached to the wrong row rather than an empty board.
 */
const LOCALE_SEGMENT = /^[a-z]{2}([_-][a-zA-Z]{2})?$/;

export function localeRelaxedKey(normalizedUrl: string): string {
  try {
    const u = new URL(normalizedUrl);
    const parts = u.pathname.split("/").filter(Boolean);
    const kept = parts.filter((p) => !LOCALE_SEGMENT.test(p));
    return `${u.host}/${kept.join("/")}${u.search}`.toLowerCase();
  } catch {
    return normalizedUrl.toLowerCase();
  }
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
    return { ok: false, error: "That does not look like a URL — include https://" };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, error: "Only http and https links can be added." };
  }

  const normalized = normalizeJobUrl(jobUrl);

  // Does the crawler already have this posting? Checked by normalised URL across every company,
  // before any company is resolved or created: the crawler stores the source's own id, so a
  // company-scoped or external-id lookup would miss it entirely and happily create a duplicate
  // of a job already on the board.
  const alreadyKnown = await db
    .select({
      id: jobs.id,
      companyId: jobs.companyId,
      title: jobs.title,
      readAt: jobs.readAt,
      companyName: companies.name,
    })
    .from(jobs)
    .innerJoin(companies, eq(companies.id, jobs.companyId))
    .where(eq(jobs.normalizedJobUrl, normalized))
    .limit(1);

  // Same posting under a different locale path. Scoped to this host so the candidate set stays
  // small, and only consulted when the exact URL found nothing.
  let known = alreadyKnown;
  if (!known.length) {
    const relaxed = localeRelaxedKey(normalized);
    const sameHost = await db
      .select({
        id: jobs.id,
        companyId: jobs.companyId,
        title: jobs.title,
        readAt: jobs.readAt,
        normalizedJobUrl: jobs.normalizedJobUrl,
        companyName: companies.name,
      })
      .from(jobs)
      .innerJoin(companies, eq(companies.id, jobs.companyId))
      .where(like(jobs.normalizedJobUrl, `%${parsed.host}%`))
      .limit(200);
    known = sameHost.filter((j) => localeRelaxedKey(j.normalizedJobUrl) === relaxed);
  }

  if (known.length) {
    const found = known[0];
    // Pasting a link is an act of attention, so the job counts as reviewed. Without this it
    // would keep showing as "to review" on a board you have demonstrably already worked through.
    if (!found.readAt) {
      await db
        .update(jobs)
        .set({ readAt: new Date(), updatedAt: new Date() })
        .where(eq(jobs.id, found.id));
    }
    return {
      ok: true,
      jobId: found.id,
      companyId: found.companyId,
      outcome: "matched_existing",
      title: found.title,
      companyName: found.companyName,
    };
  }

  // Resolve the company: an existing one, or a new manual row for a company we do not track.
  let companyId = input.companyId?.trim() || "";
  let companyName = "";
  if (companyId) {
    const rows = await db
      .select({ name: companies.name })
      .from(companies)
      .where(eq(companies.id, companyId))
      .limit(1);
    if (!rows.length) return { ok: false, error: "That company no longer exists." };
    companyName = rows[0].name;
  } else {
    companyName = (input.companyName ?? "").trim();
    if (!companyName) return { ok: false, error: "Pick a company, or type a new one." };

    const existing = await db
      .select({ id: companies.id })
      .from(companies)
      .where(eq(companies.name, companyName))
      .limit(1);

    if (existing.length) {
      companyId = existing[0].id;
    } else {
      companyId = crypto.randomUUID();
      // Manual: there is no feed behind it, and guessing one would create a source that silently
      // returns nothing forever.
      await db.insert(companies).values({
        id: companyId,
        name: companyName,
        careersUrl: `${parsed.origin}/`,
        sourceType: "manual",
        sourceTier: 6,
        sourceConfig: {},
        active: true,
      });
    }
  }

  // A second paste of the same link at the same company. Distinct from matched_existing above,
  // which is the crawler's copy; this is one you added yourself earlier.
  const externalJobId = manualExternalId(jobUrl);
  const mine = await db
    .select({ id: jobs.id, title: jobs.title })
    .from(jobs)
    .where(and(eq(jobs.companyId, companyId), eq(jobs.externalJobId, externalJobId)))
    .limit(1);

  if (mine.length) {
    return {
      ok: true,
      jobId: mine[0].id,
      companyId,
      outcome: "already_tracked",
      title: mine[0].title,
      companyName,
    };
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
    normalizedJobUrl: normalized,
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
    // Added deliberately, so it is reviewed by definition.
    readAt: new Date(),
  });

  return { ok: true, jobId, companyId, outcome: "created", title, companyName };
}
