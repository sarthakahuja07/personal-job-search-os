/**
 * Dry-run a careers URL and report what it would actually crawl, before anything is saved.
 *
 * PRD §85's rule applied to onboarding: you should not be able to save a company whose adapter
 * does not demonstrably work. Detection is pure regex, so it happily "recognises" a URL whose
 * board is empty, renamed or misspelled -- `boards.greenhouse.io/ripling` detects perfectly and
 * returns nothing forever, which is precisely the silent-zero failure this project exists to
 * prevent. Fetching once at save time is the cheapest possible guard against that.
 *
 * The most important case it catches: **SmartRecruiters returns HTTP 200 with an empty list for
 * any company id at all.** Probing `apple`, `wintwealth` and `ringg` all came back 200. Without a
 * preview, a typo there is indistinguishable from a real board until the first crawl reports
 * zero and nobody notices.
 *
 * Only tiers 1-2 can be previewed, which is also all that detection recognises. Tier 3-5 sources
 * are configured deliberately after research (see docs/source-catalogue.md) and their adapters
 * live in Python; there is nothing here to dry-run.
 */

import { detectSource, type Detection } from "@/server/domain/source-detect";
import type { SourceConfig } from "@/db/schema";

const UA = "job-search-os/0.1 (personal job-search tool; single user; respects robots.txt)";
const TIMEOUT_MS = 12_000;
/** Workday returns HTTP 400 above 20. Verified live; see docs/crawlers.md. */
const WORKDAY_PAGE = 20;

export type SourcePreview = {
  /** What detection made of the URL. Null when nothing matched. */
  detection: { sourceType: string; sourceTier: number; label: string } | null;
  /** True when the endpoint answered and returned at least one job. */
  ok: boolean;
  /** Total the board reports, when it reports one. */
  total: number | null;
  /** A few real titles, so the result is recognisable rather than a count to trust. */
  sample: string[];
  /** Set when the endpoint could not be used. Written for a human, not a log. */
  error: string | null;
};

function unrecognised(): SourcePreview {
  return {
    detection: null,
    ok: false,
    total: null,
    sample: [],
    error:
      "Not a recognised ATS URL. The company will be saved as a manual check with a link, " +
      "which is honest rather than a guess — it can be promoted later once its feed is found.",
  };
}

async function getJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    headers: { "User-Agent": UA, Accept: "application/json", ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`the board returned HTTP ${response.status}`);
  return response.json();
}

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const titleOf = (job: unknown): string | null => {
  if (typeof job !== "object" || job === null) return null;
  const r = job as Record<string, unknown>;
  const t = r.title ?? r.text ?? r.name ?? r.jobTitle;
  return typeof t === "string" && t.trim() ? t.trim() : null;
};

/** Fetch a tier 1-2 board and report its size and a few titles. */
async function probe(
  sourceType: string,
  config: SourceConfig,
): Promise<{ total: number | null; titles: string[] }> {
  const c = config as Record<string, string>;

  if (sourceType === "greenhouse") {
    const d = (await getJson(
      `https://boards-api.greenhouse.io/v1/boards/${c.boardToken}/jobs`,
    )) as { jobs?: unknown[] };
    const jobs = asArray(d.jobs);
    return { total: jobs.length, titles: jobs.map(titleOf).filter(Boolean) as string[] };
  }

  if (sourceType === "lever") {
    const d = await getJson(`https://api.lever.co/v0/postings/${c.slug}?mode=json`);
    const jobs = asArray(d);
    return { total: jobs.length, titles: jobs.map(titleOf).filter(Boolean) as string[] };
  }

  if (sourceType === "ashby") {
    const d = (await getJson(
      `https://api.ashbyhq.com/posting-api/job-board/${c.slug}`,
    )) as { jobs?: unknown[] };
    const jobs = asArray(d.jobs);
    return { total: jobs.length, titles: jobs.map(titleOf).filter(Boolean) as string[] };
  }

  if (sourceType === "smartrecruiters") {
    const d = (await getJson(
      `https://api.smartrecruiters.com/v1/companies/${c.companyId}/postings?limit=10`,
    )) as { content?: unknown[]; totalFound?: number };
    const jobs = asArray(d.content);
    return {
      total: typeof d.totalFound === "number" ? d.totalFound : jobs.length,
      titles: jobs.map(titleOf).filter(Boolean) as string[],
    };
  }

  if (sourceType === "workday") {
    const url =
      `https://${c.tenant}.${c.dataCenter}.myworkdayjobs.com/wday/cxs/` +
      `${c.tenant}/${c.site}/jobs`;
    const d = (await getJson(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limit: WORKDAY_PAGE, offset: 0, searchText: "" }),
    })) as { jobPostings?: unknown[]; total?: number };
    const jobs = asArray(d.jobPostings);
    return {
      total: typeof d.total === "number" ? d.total : jobs.length,
      titles: jobs.map(titleOf).filter(Boolean) as string[],
    };
  }

  return { total: null, titles: [] };
}

export async function previewSource(careersUrl: string): Promise<SourcePreview> {
  const url = careersUrl.trim();
  if (!url) return unrecognised();

  const detected: Detection | null = detectSource(url);
  if (!detected) return unrecognised();

  const detection = {
    sourceType: detected.sourceType,
    sourceTier: detected.sourceTier,
    label: detected.label,
  };

  try {
    const { total, titles } = await probe(detected.sourceType, detected.config);

    // Zero is the answer that matters. A regex-detected board that returns nothing is either a
    // typo or a company with no openings, and the two are indistinguishable from here -- so it
    // is reported as "not proven" rather than as success.
    if (!titles.length) {
      return {
        detection,
        ok: false,
        total,
        sample: [],
        error:
          `Recognised as ${detected.label}, but the board returned no jobs. Usually the ` +
          `identifier is wrong — SmartRecruiters in particular answers 200 for any id. ` +
          `Check the token in the URL, or save it anyway if the board is genuinely empty.`,
      };
    }

    return { detection, ok: true, total, sample: titles.slice(0, 5), error: null };
  } catch (error) {
    const reason =
      error instanceof Error && error.name === "TimeoutError"
        ? "the board did not respond in time"
        : error instanceof Error
          ? error.message
          : "the board could not be reached";
    return {
      detection,
      ok: false,
      total: null,
      sample: [],
      error: `Recognised as ${detected.label}, but ${reason}.`,
    };
  }
}
