import { describe, expect, it } from "vitest";

import {
  STAGES,
  countByStage,
  followUpsDue,
  isStage,
  transition,
  type FollowUpCandidate,
} from "./applications";

const NOW = new Date("2026-09-06T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe("stages", () => {
  it("has exactly the five stages the PRD specifies, in order", () => {
    expect(STAGES).toEqual(["saved", "requested", "referred", "applied", "interviews"]);
  });

  it.each(["saved", "interviews"])("recognises %s", (s) => {
    expect(isStage(s)).toBe(true);
  });

  it.each(["offer", "rejected", "onsite", ""])("rejects %s", (s) => {
    expect(isStage(s)).toBe(false);
  });
});

describe("transition", () => {
  it("stamps the matching timestamp on first entry", () => {
    expect(transition({}, "requested", NOW)).toEqual({
      status: "requested",
      requestedAt: NOW,
    });
    expect(transition({}, "applied", NOW)).toEqual({ status: "applied", appliedAt: NOW });
    expect(transition({}, "interviews", NOW)).toEqual({
      status: "interviews",
      interviewStartedAt: NOW,
    });
  });

  it("stamps nothing for saved, which is not an event", () => {
    expect(transition({}, "saved", NOW)).toEqual({ status: "saved" });
  });

  it("does not overwrite a timestamp that already exists", () => {
    const original = daysAgo(9);
    const patch = transition({ requestedAt: original }, "requested", NOW);
    expect(patch).toEqual({ status: "requested" });
  });

  // Moving a card back corrects the current state; it does not claim the earlier event never
  // happened. "When did I ask for the referral" must survive a mis-drag.
  it("keeps earlier timestamps when a card moves backwards", () => {
    const requested = daysAgo(10);
    const patch = transition({ requestedAt: requested, appliedAt: daysAgo(2) }, "requested", NOW);
    expect(patch).toEqual({ status: "requested" });
    expect(patch).not.toHaveProperty("requestedAt");
  });
});

describe("followUpsDue", () => {
  const candidate = (over: Partial<FollowUpCandidate> = {}): FollowUpCandidate => ({
    id: "a1",
    status: "requested",
    requestedAt: daysAgo(7),
    jobTitle: "Software Engineer II",
    companyName: "Adobe",
    ...over,
  });

  it("returns referrals waiting at or beyond the threshold", () => {
    const due = followUpsDue([candidate()], 5, NOW);
    expect(due).toHaveLength(1);
    expect(due[0].daysWaiting).toBe(7);
  });

  it("ignores referrals still inside the threshold", () => {
    expect(followUpsDue([candidate({ requestedAt: daysAgo(2) })], 5, NOW)).toHaveLength(0);
  });

  it("includes one exactly at the threshold", () => {
    expect(followUpsDue([candidate({ requestedAt: daysAgo(5) })], 5, NOW)).toHaveLength(1);
  });

  // Once a referral is in, the ball is not in Sarthak's court -- and nagging someone who has
  // already helped is worse than not following up at all.
  it.each(["saved", "referred", "applied", "interviews"] as const)(
    "never chases a %s application",
    (status) => {
      expect(followUpsDue([candidate({ status })], 5, NOW)).toHaveLength(0);
    },
  );

  it("skips a requested application with no timestamp rather than assuming today", () => {
    expect(followUpsDue([candidate({ requestedAt: null })], 5, NOW)).toHaveLength(0);
  });

  it("sorts the longest wait first", () => {
    const due = followUpsDue(
      [
        candidate({ id: "recent", requestedAt: daysAgo(6) }),
        candidate({ id: "stale", requestedAt: daysAgo(20) }),
        candidate({ id: "mid", requestedAt: daysAgo(11) }),
      ],
      5,
      NOW,
    );
    expect(due.map((d) => d.id)).toEqual(["stale", "mid", "recent"]);
  });
});

describe("countByStage", () => {
  it("returns every stage, including empty ones, so the board is stable", () => {
    const counts = countByStage([{ status: "saved" }, { status: "saved" }]);
    expect(counts).toEqual({
      saved: 2,
      requested: 0,
      referred: 0,
      applied: 0,
      interviews: 0,
    });
  });

  it("counts an empty list without throwing", () => {
    expect(countByStage([]).saved).toBe(0);
  });
});
