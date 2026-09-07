/**
 * Chunked ingest must produce exactly one run record.
 *
 * Regression: a company whose jobs exceed one request is split into chunks, and every chunk but
 * the last deliberately carries an empty `seen_external_ids` (the full observed set rides on the
 * final one). Recording each chunk therefore wrote a zero-jobs row and flipped the company to
 * `suspicious` mid-crawl. Amazon did this on every run for its 2,385 jobs.
 *
 * The stray row is not the real cost. The zero-result guard is the alarm that distinguishes "no
 * new jobs this week" from "the crawler quietly broke" -- the one failure this project exists to
 * catch. An alarm that fires on every healthy run of the largest source teaches you to ignore it.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../repository/ingest-repo", () => ({
  loadCompany: vi.fn(),
  loadSettings: vi.fn(),
  loadExistingJobs: vi.fn(),
  recentMedianJobCount: vi.fn(),
  upsertJobs: vi.fn(),
  jobIdsByExternalId: vi.fn(),
  queueNotifications: vi.fn(),
  incrementMissing: vi.fn(),
  resetMissing: vi.fn(),
  closeJobs: vi.fn(),
  recordCrawlRun: vi.fn(),
  updateCompanyHealth: vi.fn(),
}));

import { DEFAULT_MATCH_RULES } from "../domain/matching";
import * as repo from "../repository/ingest-repo";
import { ingestPayloadSchema } from "../schemas/ingest";
import { ingestJobs } from "./ingest";

const db = {} as never;

function job(id: string) {
  return {
    external_job_id: id,
    title: "Software Engineer II",
    job_url: `https://example.com/jobs/${id}`,
    location: "Bengaluru, India",
  };
}

function payload(over: Record<string, unknown> = {}) {
  return ingestPayloadSchema.parse({
    run_id: "run-1",
    company_id: "c1",
    status: "success",
    jobs: [job("a1")],
    seen_external_ids: ["a1"],
    ...over,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(repo.loadCompany).mockResolvedValue({
    id: "c1",
    name: "Amazon",
    active: true,
    sourceType: "json_api",
    allowZeroResults: false,
  } as never);
  vi.mocked(repo.loadSettings).mockResolvedValue({
    rules: DEFAULT_MATCH_RULES,
    closeAfterMissingRuns: 3,
  } as never);
  // A company that has returned jobs before -- the precondition for the zero-result guard.
  vi.mocked(repo.loadExistingJobs).mockResolvedValue([
    { id: "j1", externalJobId: "a1", normalizedJobUrl: "https://example.com/jobs/a1" },
  ] as never);
  vi.mocked(repo.recentMedianJobCount).mockResolvedValue(null);
  vi.mocked(repo.jobIdsByExternalId).mockResolvedValue(new Map() as never);
  vi.mocked(repo.queueNotifications).mockResolvedValue(0 as never);
});

describe("chunked ingest", () => {
  it("records no run and touches no health for a non-final chunk", async () => {
    await ingestJobs(db, payload({ is_final: false, seen_external_ids: [] }));
    expect(repo.recordCrawlRun).not.toHaveBeenCalled();
    expect(repo.updateCompanyHealth).not.toHaveBeenCalled();
  });

  it("still writes the jobs carried by a non-final chunk", async () => {
    await ingestJobs(db, payload({ is_final: false, seen_external_ids: [] }));
    expect(repo.upsertJobs).toHaveBeenCalledOnce();
  });

  it("records exactly one run for the final chunk, with the full observed set", async () => {
    await ingestJobs(db, payload({ is_final: true, seen_external_ids: ["a1", "a2"] }));
    expect(repo.recordCrawlRun).toHaveBeenCalledOnce();
    expect(vi.mocked(repo.recordCrawlRun).mock.calls[0][1]).toMatchObject({
      status: "success",
      jobsFound: 2,
    });
  });

  it("defaults to final, so an unchunked post is still recorded", async () => {
    await ingestJobs(db, payload());
    expect(repo.recordCrawlRun).toHaveBeenCalledOnce();
  });

  it("a whole chunked run produces one record, not one per chunk", async () => {
    await ingestJobs(db, payload({ is_final: false, seen_external_ids: [], jobs: [job("a1")] }));
    await ingestJobs(db, payload({ is_final: false, seen_external_ids: [], jobs: [job("a2")] }));
    await ingestJobs(db, payload({ is_final: true, seen_external_ids: ["a1", "a2"] }));
    expect(repo.recordCrawlRun).toHaveBeenCalledOnce();
    expect(vi.mocked(repo.recordCrawlRun).mock.calls[0][1]).toMatchObject({ status: "success" });
  });

  it("a genuinely empty board is still suspicious when it is the final word", async () => {
    await ingestJobs(db, payload({ is_final: true, seen_external_ids: [], jobs: [] }));
    expect(vi.mocked(repo.recordCrawlRun).mock.calls[0][1]).toMatchObject({
      status: "suspicious",
      jobsFound: 0,
    });
  });
});
