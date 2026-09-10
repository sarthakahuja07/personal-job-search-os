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

describe("closing a reminder", () => {
  const dismissedAt = (jobId: string, kind: string, at: Date) =>
    new Map([[`${jobId}:${kind}`, at]]);

  it("hides a reminder that was closed after it was raised", () => {
    const c = candidate({ jobId: "j1", status: "requested", requestedAt: daysAgo(9) });
    expect(buildReminders([c], DEFAULT_THRESHOLDS, NOW)).toHaveLength(1);
    expect(
      buildReminders([c], DEFAULT_THRESHOLDS, NOW, dismissedAt("j1", "referral_status", daysAgo(1))),
    ).toEqual([]);
  });

  // The point of comparing against `since` rather than just storing a flag: closing is "not
  // now", and a job that moves stage is a new situation that deserves to be raised again.
  it("returns once the job moves to a stage whose clock starts later", () => {
    const closed = dismissedAt("j1", "apply_after_referral", daysAgo(5));
    const moved = candidate({ jobId: "j1", status: "referred", referredAt: daysAgo(3) });
    const r = buildReminders([moved], DEFAULT_THRESHOLDS, NOW, closed);
    expect(r).toHaveLength(1);
    expect(r[0].kind).toBe("apply_after_referral");
  });

  it("only silences the kind that was closed", () => {
    const c = candidate({ jobId: "j1", status: "applied", appliedAt: daysAgo(30) });
    expect(
      buildReminders([c], DEFAULT_THRESHOLDS, NOW, dismissedAt("j1", "referral_status", NOW)),
    ).toHaveLength(1);
  });

  it("only silences the job that was closed", () => {
    const rs = buildReminders(
      [
        candidate({ jobId: "a", status: "requested", requestedAt: daysAgo(9) }),
        candidate({ jobId: "b", status: "requested", requestedAt: daysAgo(9) }),
      ],
      DEFAULT_THRESHOLDS,
      NOW,
      dismissedAt("a", "referral_status", daysAgo(1)),
    );
    expect(rs.map((r) => r.jobId)).toEqual(["b"]);
  });

  it("is inert with no dismissals", () => {
    const c = candidate({ status: "requested", requestedAt: daysAgo(9) });
    expect(buildReminders([c], DEFAULT_THRESHOLDS, NOW, new Map())).toHaveLength(1);
  });
});

describe("configurable thresholds", () => {
  const c = candidate({ status: "requested", requestedAt: daysAgo(3) });

  it("stays quiet at the default and fires when tightened", () => {
    expect(buildReminders([c], DEFAULT_THRESHOLDS, NOW)).toHaveLength(0);
    expect(
      buildReminders([c], { ...DEFAULT_THRESHOLDS, referralStatusDays: 2 }, NOW),
    ).toHaveLength(1);
  });

  it("can be relaxed to silence a rule that would otherwise fire", () => {
    const applied = candidate({ status: "applied", appliedAt: daysAgo(20) });
    expect(buildReminders([applied], DEFAULT_THRESHOLDS, NOW)).toHaveLength(1);
    expect(
      buildReminders([applied], { ...DEFAULT_THRESHOLDS, applicationSilentDays: 60 }, NOW),
    ).toHaveLength(0);
  });
});
