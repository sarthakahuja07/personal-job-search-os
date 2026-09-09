import { describe, expect, it } from "vitest";

import {
  buildReminders,
  DEFAULT_THRESHOLDS,
  type ReminderCandidate,
} from "./reminders";

const NOW = new Date("2026-09-20T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

function candidate(over: Partial<ReminderCandidate> = {}): ReminderCandidate {
  return {
    jobId: "j1",
    jobTitle: "Software Engineer II",
    companyId: "c1",
    companyName: "Rippling",
    status: null,
    requestedAt: null,
    referredAt: null,
    appliedAt: null,
    savedAt: null,
    discoveredAt: daysAgo(1),
    fitBand: "good",
    hasContact: true,
    ...over,
  };
}

const build = (c: Partial<ReminderCandidate>) =>
  buildReminders([candidate(c)], DEFAULT_THRESHOLDS, NOW);

describe("referral status", () => {
  it("fires once a referral request has gone unanswered past the threshold", () => {
    const r = build({ status: "requested", requestedAt: daysAgo(5) });
    expect(r).toHaveLength(1);
    expect(r[0].kind).toBe("referral_status");
    expect(r[0].daysWaiting).toBe(5);
  });

  it("stays quiet before the threshold", () => {
    expect(build({ status: "requested", requestedAt: daysAgo(2) })).toHaveLength(0);
  });

  // Chasing someone who has already helped is worse than not chasing at all.
  it("never fires once the referral has actually been given", () => {
    expect(
      build({ status: "referred", requestedAt: daysAgo(30), referredAt: daysAgo(1) }),
    ).toHaveLength(0);
  });

  it("says so when there is no contact to chase", () => {
    const r = build({ status: "requested", requestedAt: daysAgo(6), hasContact: false });
    expect(r[0].action).toMatch(/no contact saved/);
  });
});

describe("apply after referral", () => {
  // The most expensive gap in the pipeline: someone spent their credibility and the application
  // was never submitted.
  it("fires quickly, because a referral has a shelf life", () => {
    const r = build({ status: "referred", referredAt: daysAgo(2) });
    expect(r[0].kind).toBe("apply_after_referral");
    expect(r[0].action).toMatch(/Submit the application/);
  });

  it("is quiet on the same day the referral lands", () => {
    expect(build({ status: "referred", referredAt: NOW })).toHaveLength(0);
  });
});

describe("other stages", () => {
  it("asks for a decision on a job that has sat saved", () => {
    expect(build({ status: "saved", savedAt: daysAgo(4) })[0].kind).toBe("decide_on_saved");
  });

  it("falls back to discovery when a saved job has no saved date", () => {
    const r = build({ status: "saved", savedAt: null, discoveredAt: daysAgo(9) });
    expect(r[0].daysWaiting).toBe(9);
  });

  it("raises a silent application only after a fortnight", () => {
    expect(build({ status: "applied", appliedAt: daysAgo(13) })).toHaveLength(0);
    expect(build({ status: "applied", appliedAt: daysAgo(14) })[0].kind).toBe(
      "application_silent",
    );
  });

  it("ignores jobs already in interviews", () => {
    expect(build({ status: "interviews", appliedAt: daysAgo(60) })).toHaveLength(0);
  });
});

describe("untouched strong matches", () => {
  it("raises an excellent match nobody has acted on", () => {
    const r = build({ status: null, fitBand: "excellent", discoveredAt: daysAgo(3) });
    expect(r[0].kind).toBe("strong_match_untouched");
    expect(r[0].detail).toMatch(/Excellent match/);
  });

  // Reminding about every job would just reproduce the board, and a reminder list nobody
  // trusts is worse than no reminder list.
  it.each(["good", "fair", "weak"] as const)("ignores a %s match", (fitBand) => {
    expect(build({ status: null, fitBand, discoveredAt: daysAgo(30) })).toHaveLength(0);
  });

  it("stops once the job enters the pipeline", () => {
    expect(
      build({ status: "saved", savedAt: daysAgo(1), fitBand: "excellent", discoveredAt: daysAgo(30) }),
    ).toHaveLength(0);
  });
});

describe("shape", () => {
  it("marks double the threshold as overdue", () => {
    expect(build({ status: "requested", requestedAt: daysAgo(5) })[0].severity).toBe("due");
    expect(build({ status: "requested", requestedAt: daysAgo(10) })[0].severity).toBe("overdue");
  });

  it("sorts overdue first, then longest waiting", () => {
    const rs = buildReminders(
      [
        candidate({ jobId: "a", status: "requested", requestedAt: daysAgo(5) }),
        candidate({ jobId: "b", status: "requested", requestedAt: daysAgo(40) }),
        candidate({ jobId: "c", status: "requested", requestedAt: daysAgo(12) }),
      ],
      DEFAULT_THRESHOLDS,
      NOW,
    );
    expect(rs.map((r) => r.jobId)).toEqual(["b", "c", "a"]);
  });

  it("raises at most one reminder per job", () => {
    const r = build({
      status: "requested",
      requestedAt: daysAgo(40),
      savedAt: daysAgo(40),
      discoveredAt: daysAgo(40),
      fitBand: "excellent",
    });
    expect(r).toHaveLength(1);
  });

  it("always names the date the clock started from", () => {
    const r = build({ status: "requested", requestedAt: daysAgo(7) });
    expect(r[0].since).toEqual(daysAgo(7));
  });

  it("is empty for a healthy pipeline", () => {
    expect(
      buildReminders(
        [
          candidate({ status: "requested", requestedAt: daysAgo(1) }),
          candidate({ status: "referred", referredAt: NOW }),
          candidate({ status: null, fitBand: "good" }),
        ],
        DEFAULT_THRESHOLDS,
        NOW,
      ),
    ).toEqual([]);
  });
});

describe("read jobs", () => {
  // Marking a job read is a decision. Nagging about a role you have already considered and
  // passed on is how a reminder list loses its authority.
  it("does not chase a strong match that was read and passed over", () => {
    expect(
      build({
        status: null,
        fitBand: "excellent",
        discoveredAt: daysAgo(10),
        readAt: daysAgo(1),
      }),
    ).toHaveLength(0);
  });

  it("still chases one that was never read", () => {
    expect(
      build({ status: null, fitBand: "excellent", discoveredAt: daysAgo(10), readAt: null }),
    ).toHaveLength(1);
  });

  // Reading is weaker than acting: a referral already asked for still needs chasing.
  it("keeps chasing a pipeline job even when read", () => {
    expect(
      build({ status: "requested", requestedAt: daysAgo(9), readAt: daysAgo(1) }),
    ).toHaveLength(1);
  });
});

describe("finished applications", () => {
  // Selected and Rejected are endings. A reminder to chase a rejection is the fastest way to
  // teach someone to ignore the list entirely.
  it.each(["selected", "rejected"] as const)("never chases a %s job", (status) => {
    expect(
      buildReminders(
        [
          candidate({
            status,
            requestedAt: daysAgo(60),
            referredAt: daysAgo(50),
            appliedAt: daysAgo(40),
            savedAt: daysAgo(90),
            discoveredAt: daysAgo(90),
            fitBand: "excellent",
          }),
        ],
        DEFAULT_THRESHOLDS,
        NOW,
      ),
    ).toEqual([]);
  });

  it("still chases one that is only applied", () => {
    expect(build({ status: "applied", appliedAt: daysAgo(40) })).toHaveLength(1);
  });
});
