/**
 * Job URL normalization -- the fallback identity for sources with no stable requisition id.
 *
 * Mirrors crawler/models/job.py::normalize_job_url. Both sides must agree, or a job ingested
 * by one path would not dedupe against the other.
 *
 * The hard-won rule here: strip only KNOWN TRACKING parameters, never the whole query string.
 * Greenhouse-hosted boards put the job id in the query -- Databricks postings look like
 * `.../open-positions/job?gh_jid=7979886003` -- so blanket query stripping collapsed all 870
 * of their jobs onto one URL. Remaining parameters are sorted so ordering cannot change the
 * identity between crawls.
 */

/** Parameters that vary between crawls and never carry identity. */
const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gh_src",
  "src",
  "source",
  "ref",
  "referrer",
  "fbclid",
  "gclid",
  "msclkid",
  "mc_cid",
  "mc_eid",
  "trk",
  "trackingid",
  "_ga",
  "sessionid",
  "session_id",
]);

export function normalizeJobUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    const path = u.pathname.replace(/\/+$/, "") || "/";

    const kept: [string, string][] = [];
    for (const [key, value] of u.searchParams) {
      if (!TRACKING_PARAMS.has(key.toLowerCase())) kept.push([key, value]);
    }
    kept.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

    const query = kept.length
      ? "?" + kept.map(([k, v]) => `${k}=${v}`).join("&")
      : "";

    return `${u.protocol.toLowerCase()}//${u.host.toLowerCase()}${path}${query}`;
  } catch {
    // Never throw here: an unparseable URL should fail validation at the boundary, not
    // crash ingest halfway through a batch.
    return url.trim().toLowerCase();
  }
}
