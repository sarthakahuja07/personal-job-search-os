import { describe, expect, it } from "vitest";

import { ago, buildHrList, type HrCompany, type HrContact, type HrOpening } from "./hr";

const NOW = new Date("2026-10-28T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

function contact(over: Partial<HrContact> = {}): HrContact {
  return {
    id: "h1",
    name: "Spoorthi",
    phone: "+91 91106 88440",
    email: null,
    linkedinUrl: null,
    notes: null,
    lastCalledAt: null,
    ...over,
  };
}

function company(over: Partial<HrCompany> = {}): HrCompany {
  return {
    id: "c1",
    name: "CRED",
    careersUrl: null,
    sourceType: "lever",
    active: true,
    healthStatus: "healthy",
    contacts: [contact()],
    ...over,
  };
}

function opening(over: Partial<HrOpening> = {}): HrOpening {
  return {
    jobId: "j1",
    companyId: "c1",
    title: "Software Engineer II",
    location: "Bangalore",
    jobUrl: "https://example.com/j1",
    discoveredAt: daysAgo(1),
    fitScore: 60,
    fitBand: "good",
    status: null,
    ...over,
  };
}

describe("buildHrList", () => {
  it("prompts a call for an opening when HR has never been called", () => {
    const [e] = buildHrList([company()], [opening()], NOW);
    expect(e.state).toBe("call");
    expect(e.headline).toBe("Call Spoorthi");
    expect(e.detail).toContain("have not called yet");
    expect(e.hot).toBe(true);
  });

  it("stops prompting once HR was called after the opening appeared", () => {
    const c = company({ contacts: [contact({ lastCalledAt: daysAgo(0.5) })] });
    const [e] = buildHrList([c], [opening({ discoveredAt: daysAgo(2) })], NOW);
    expect(e.state).toBe("called");
    expect(e.fresh).toHaveLength(0);
    expect(e.openings).toHaveLength(1);
  });

  it("prompts again when a new opening appears after the call", () => {
    const c = company({ contacts: [contact({ lastCalledAt: daysAgo(5) })] });
    const [e] = buildHrList(
      [c],
      [opening({ jobId: "old", discoveredAt: daysAgo(10) }), opening({ jobId: "new", discoveredAt: daysAgo(1) })],
      NOW,
    );
    expect(e.state).toBe("call");
    expect(e.fresh.map((o) => o.jobId)).toEqual(["new"]);
    expect(e.detail).toContain("since you last called 5 days ago");
  });

  it("counts a call to any HR contact as a call to the company", () => {
    const c = company({
      contacts: [
        contact({ id: "a", name: "CRED HR", lastCalledAt: null }),
        contact({ id: "b", name: "Spoorthi", lastCalledAt: daysAgo(0.5) }),
      ],
    });
    const [e] = buildHrList([c], [opening({ discoveredAt: daysAgo(2) })], NOW);
    expect(e.state).toBe("called");
    // The one spoken to last is the warmest line.
    expect(e.primary?.id).toBe("b");
  });

  it("ignores finished applications but keeps ones still in the pipeline", () => {
    const [e] = buildHrList(
      [company()],
      [opening({ jobId: "done", status: "rejected" }), opening({ jobId: "live", status: "applied" })],
      NOW,
    );
    expect(e.openings.map((o) => o.jobId)).toEqual(["live"]);
  });

  it("calls an uncrawled company out as untracked rather than quiet", () => {
    const [e] = buildHrList([company({ sourceType: "manual" })], [], NOW);
    expect(e.state).toBe("untracked");
    expect(e.headline).toBe("Ask Spoorthi what is open");
  });

  it("is quiet for a crawled company with nothing open", () => {
    const [e] = buildHrList([company()], [], NOW);
    expect(e.state).toBe("quiet");
  });

  it("skips companies with no HR contact", () => {
    expect(buildHrList([company({ contacts: [] })], [opening()], NOW)).toEqual([]);
  });

  it("orders calls hot first, then by best fit", () => {
    const list = buildHrList(
      [
        company({ id: "old", name: "Old" }),
        company({ id: "weak", name: "Weak" }),
        company({ id: "strong", name: "Strong" }),
        company({ id: "none", name: "None" }),
      ],
      [
        opening({ jobId: "1", companyId: "old", discoveredAt: daysAgo(9), fitScore: 95 }),
        opening({ jobId: "2", companyId: "weak", fitScore: 40 }),
        opening({ jobId: "3", companyId: "strong", fitScore: 85 }),
      ],
      NOW,
    );
    expect(list.map((e) => e.company.id)).toEqual(["strong", "weak", "old", "none"]);
  });
});

describe("ago", () => {
  it("speaks in whole days", () => {
    expect(ago(daysAgo(0.2), NOW)).toBe("today");
    expect(ago(daysAgo(1.5), NOW)).toBe("yesterday");
    expect(ago(daysAgo(6), NOW)).toBe("6 days ago");
  });
});
