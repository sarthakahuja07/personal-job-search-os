import { describe, expect, it } from "vitest";

import {
  ID_CHUNK,
  JOB_CHUNK,
  JOB_COLUMNS,
  NOTIFICATION_CHUNK,
  NOTIFICATION_COLUMNS,
} from "./ingest-repo";

/**
 * D1 permits 100 bound parameters per query. A multi-row insert binds
 * (rows × columns) of them, so every chunk size is that limit divided by the row width.
 *
 * This is arithmetic, not logic, which is exactly why it went wrong in production: the job
 * chunk was sized correctly and the notification chunk was not, and nothing failed until a
 * company arrived with enough new matches to fill it. Amazon's first crawl produced 181
 * notifications and died with "too many SQL variables" after every smaller company had been
 * ingesting cleanly for weeks.
 *
 * Adding a column to either table without re-deriving its chunk breaks these.
 */
const MAX_BOUND_PARAMS = 100;

describe("D1 bound-parameter budget", () => {
  it("keeps a job insert chunk inside the limit", () => {
    expect(JOB_CHUNK * JOB_COLUMNS).toBeLessThanOrEqual(MAX_BOUND_PARAMS);
  });

  it("keeps a notification insert chunk inside the limit", () => {
    expect(NOTIFICATION_CHUNK * NOTIFICATION_COLUMNS).toBeLessThanOrEqual(MAX_BOUND_PARAMS);
  });

  it("keeps an id list inside the limit", () => {
    expect(ID_CHUNK).toBeLessThanOrEqual(MAX_BOUND_PARAMS);
  });

  // A chunk of zero would loop forever without inserting anything.
  it.each([
    ["job", JOB_CHUNK],
    ["notification", NOTIFICATION_CHUNK],
    ["id", ID_CHUNK],
  ])("uses a non-zero %s chunk", (_label, chunk) => {
    expect(chunk).toBeGreaterThan(0);
  });

  // Guards against over-correcting into a chunk so small that a large crawl exceeds D1's
  // 50-queries-per-invocation limit instead.
  it("still fits a 100-job request inside the per-invocation query budget", () => {
    const upsertQueries = Math.ceil(100 / JOB_CHUNK);
    const overhead = 8; // company, settings, existing jobs, medians, run, health, ids, notifications
    expect(upsertQueries + overhead).toBeLessThanOrEqual(50);
  });
});
