import { describe, expect, it } from "vitest";

import { applyFitFloor, scoreFit } from "./fit";
import { planIngest, type IncomingJob, type PlanInput } from "./ingest-plan";
import { DEFAULT_MATCH_RULES, mergeOverrides } from "./matching";

const passing = { isRelevant: true, reason: "SDE 2 (+100), Bangalore (+40)" };

describe("applyFitFloor", () => {
  it("is a no-op for a company without a floor", () => {
    expect(applyFitFloor(passing, { score: 10, titleOnly: false }, undefined)).toBe(passing);
  });

  it("takes a described job below the floor off the board, and says why", () => {
    const v = applyFitFloor(passing, { score: 52, titleOnly: false }, 65);
    expect(v.isRelevant).toBe(false);
    expect(v.reason).toBe("fit 52 is below this company's minimum of 65");
  });

  it("keeps a job at or above the floor", () => {
    const v = applyFitFloor(passing, { score: 65, titleOnly: false }, 65);
    expect(v.isRelevant).toBe(true);
    expect(v.reason).toContain("fit 65 ≥ 65");
  });

  it("never drops a title-only job for evidence that was never available", () => {
    const v = applyFitFloor(passing, { score: 20, titleOnly: true }, 65);
    expect(v.isRelevant).toBe(true);
    expect(v.reason).toContain("fit not assessed");
  });

  it("cannot make a gate-rejected job relevant", () => {
    const rejected = { isRelevant: false, reason: "location not allowed" };
    expect(applyFitFloor(rejected, { score: 95, titleOnly: false }, 65)).toBe(rejected);
  });
});

describe("planIngest with a fit floor", () => {
  const thin: IncomingJob = {
    externalJobId: "A-1",
    title: "Software Development Engineer II",
    jobUrl: "https://amazon.jobs/1",
    normalizedJobUrl: "https://amazon.jobs/1",
    location: "Bengaluru, India",
    // Long enough to be scored on (fit treats under 200 chars as title-only).
    description:
      "Join our retail catalogue team. You will work with stakeholders across the business, " +
      "write clear documentation, take part in planning, and support launches. Strong " +
      "communication skills and ownership are expected. 3+ years of experience.",
  };
  const base: PlanInput = {
    reportedStatus: "success",
    seenExternalIds: ["A-1"],
    jobs: [thin],
    existing: [],
    rules: DEFAULT_MATCH_RULES,
    recentMedianCount: null,
    allowZeroResults: false,
    hasSeenJobsBefore: false,
    isFinal: true,
    closeAfterMissingRuns: 3,
  };

  // One point above the job's own fit, so the test does not depend on the profile's weights.
  const floor =
    scoreFit({ title: thin.title, description: thin.description, locationPriority: 1, postedAt: null })
      .score + 1;

  it("stores the job as not relevant and queues no email", () => {
    const plan = planIngest({ ...base, matchOverrides: { minFit: floor } });
    expect(plan.upserts[0].isRelevant).toBe(false);
    expect(plan.upserts[0].matchReason).toBe(
      `fit ${floor - 1} is below this company's minimum of ${floor}`,
    );
    expect(plan.notifications).toHaveLength(0);
  });

  it("is unchanged for a company without one", () => {
    const plan = planIngest(base);
    expect(plan.upserts[0].isRelevant).toBe(true);
    expect(plan.notifications).toHaveLength(1);
  });
});

describe("mergeOverrides", () => {
  it("keeps keys the form does not show, such as aliases", () => {
    const merged = mergeOverrides({ aliases: ["Amazon Web Services (AWS)"] }, null, "65");
    expect(merged).toEqual({ aliases: ["Amazon Web Services (AWS)"], minFit: 65 });
  });

  it("clears a field left blank, and returns null when nothing is left", () => {
    expect(mergeOverrides({ minFit: 65, levelTitles: ["x"] }, null, "")).toBeNull();
  });

  it("clamps the floor to 0-100", () => {
    expect(mergeOverrides(null, null, "140")).toEqual({ minFit: 100 });
  });
});
