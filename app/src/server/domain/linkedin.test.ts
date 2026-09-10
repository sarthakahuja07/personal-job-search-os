import { describe, expect, it } from "vitest";

import {
  cityKey,
  companyKey,
  type ExistingJob,
  type LinkedInPosting,
  resolveLinkedInPostings,
  titleKey,
} from "./linkedin";

const posting = (over: Partial<LinkedInPosting> = {}): LinkedInPosting => ({
  linkedinJobId: "4012345678",
  companyName: "Amazon",
  title: "Software Development Engineer II",
  location: "Bengaluru, Karnataka, India",
  jobUrl: "https://www.linkedin.com/jobs/view/4012345678/",
  postedAt: new Date("2026-09-08T00:00:00Z"),
  feed: "search",
  ...over,
});

const job = (over: Partial<ExistingJob> = {}): ExistingJob => ({
  id: "job-1",
  companyId: "amazon",
  title: "Software Development Engineer II",
  location: "Bangalore, India",
  postedAt: new Date("2026-09-07T00:00:00Z"),
  linkedinJobId: null,
  ...over,
});

const AMAZON = [{ id: "amazon", name: "Amazon" }];

const resolve = (
  postings: LinkedInPosting[],
  companies = AMAZON,
  existingJobs: ExistingJob[] = [],
) => resolveLinkedInPostings({ postings, companies, existingJobs });

describe("companyKey", () => {
  it.each([
    ["Sigmoid", "Sigmoid Technologies"],
    ["Google", "Google India"],
    ["Rippling", "Rippling Inc."],
    ["Amazon Web Services", "Amazon Web Services (AWS)"],
    ["slice", "SLICE"],
  ])("treats %s and %s as one employer", (a, b) => {
    expect(companyKey(a)).toBe(companyKey(b));
  });

  // The whole reason this is exact-match: a substring rule would make these the same company,
  // and the job card would then offer a referral contact who cannot help.
  it("keeps genuinely different employers apart", () => {
    expect(companyKey("Apple")).not.toBe(companyKey("Apple Hospitality"));
    expect(companyKey("Navi")).not.toBe(companyKey("Navi Mumbai Logistics"));
  });
});

describe("titleKey", () => {
  it("reads Roman and Arabic levels as the same level", () => {
    expect(titleKey("Software Engineer II")).toBe(titleKey("Software Engineer 2"));
    expect(titleKey("SDE III")).toBe(titleKey("SDE 3"));
  });

  it("ignores parenthesised qualifiers", () => {
    expect(titleKey("Backend Engineer (Remote)")).toBe(titleKey("Backend Engineer"));
  });

  it("does not conflate different levels", () => {
    expect(titleKey("Software Engineer II")).not.toBe(titleKey("Software Engineer III"));
  });
});

describe("cityKey", () => {
  it.each([
    ["Bengaluru, Karnataka, India", "bangalore"],
    ["Bangalore Urban, Karnataka", "bangalore"],
    ["Gurugram, Haryana", "gurgaon"],
    ["Gurgaon", "gurgaon"],
  ])("resolves %s", (input, expected) => {
    expect(cityKey(input)).toBe(expected);
  });

  // "India" is not a city. Treating it as one would make every Indian job mergeable with
  // every other, which is the worst possible failure for this feature.
  it.each(["India", "", null, "Somewhere Else"])("returns null for %s", (input) => {
    expect(cityKey(input)).toBeNull();
  });
});

describe("merging against the existing board", () => {
  it("links an ATS job rather than creating a second card", () => {
    const r = resolve([posting()], AMAZON, [job()]);
    expect(r.inserts).toHaveLength(0);
    expect(r.leads).toHaveLength(0);
    expect(r.merges).toEqual([
      {
        jobId: "job-1",
        linkedinJobId: "4012345678",
        linkedinUrl: "https://www.linkedin.com/jobs/view/4012345678/",
      },
    ]);
  });

  it("merges across a qualifier suffix", () => {
    const r = resolve([posting({ title: "Software Development Engineer II, AWS" })], AMAZON, [
      job(),
    ]);
    expect(r.merges).toHaveLength(1);
  });

  // Without the three-word floor, a bare "Engineer" would prefix-match every role there is.
  it("does not merge on a short prefix", () => {
    const r = resolve([posting({ title: "Engineer" })], AMAZON, [job({ title: "Engineer II" })]);
    expect(r.merges).toHaveLength(0);
    expect(r.inserts).toHaveLength(1);
  });

  // Straight from a real alert: LinkedIn listed "Software Development Engineer" while the board
  // held "Software Development Engineer II". The prefix rule merged them until it learned to
  // read what the longer title actually adds -- a qualifier is the same role, a level is not.
  it.each([
    ["Software Development Engineer", "Software Development Engineer II"],
    ["Software Engineer", "Software Engineer 3"],
    ["Backend Software Engineer", "Backend Software Engineer Senior"],
  ])("does not merge %s into %s", (a, b) => {
    const r = resolve([posting({ title: a })], AMAZON, [job({ title: b })]);
    expect(r.merges).toHaveLength(0);
    expect(r.inserts).toHaveLength(1);
  });

  it("still merges when the extra words are a qualifier, not a level", () => {
    const r = resolve([posting({ title: "Software Development Engineer II" })], AMAZON, [
      job({ title: "Software Development Engineer II, Just Walk Out" }),
    ]);
    expect(r.merges).toHaveLength(1);
  });

  it("refuses to merge two known but different cities", () => {
    const r = resolve([posting({ location: "Hyderabad, Telangana, India" })], AMAZON, [job()]);
    expect(r.merges).toHaveLength(0);
    expect(r.inserts).toHaveLength(1);
  });

  it("still merges when one side has no location", () => {
    const r = resolve([posting({ location: null })], AMAZON, [job()]);
    expect(r.merges).toHaveLength(1);
  });

  it("inserts when the company is on the board but the opening is new", () => {
    const r = resolve([posting({ title: "Frontend Engineer II" })], AMAZON, [job()]);
    expect(r.merges).toHaveLength(0);
    expect(r.inserts).toEqual([{ companyId: "amazon", posting: expect.objectContaining({ title: "Frontend Engineer II" }) }]);
  });
});

describe("companies that are not on the board", () => {
  // Sarthak curates the company list by hand, so an alert can propose but never add.
  it("parks the posting as a lead", () => {
    const r = resolve([posting({ companyName: "Some Startup" })], AMAZON, [job()]);
    expect(r.merges).toHaveLength(0);
    expect(r.inserts).toHaveLength(0);
    expect(r.leads.map((l) => l.companyName)).toEqual(["Some Startup"]);
  });
});

describe("running twice", () => {
  // The crawl runs every 12 hours and the same alert mail is read each time.
  it("re-merges nothing once the link is recorded", () => {
    const r = resolve([posting()], AMAZON, [job({ linkedinJobId: "4012345678" })]);
    expect(r).toEqual({ merges: [], inserts: [], leads: [] });
  });

  it("collapses the same posting arriving in two alerts", () => {
    const r = resolve([posting({ feed: "search" }), posting({ feed: "recommended" })], AMAZON, []);
    expect(r.inserts).toHaveLength(1);
  });
});

describe("several identical openings at one employer", () => {
  const three = [
    job({ id: "old", postedAt: new Date("2026-09-01T00:00:00Z") }),
    job({ id: "new", postedAt: new Date("2026-09-06T00:00:00Z") }),
    job({ id: "taken", postedAt: new Date("2026-09-09T00:00:00Z"), linkedinJobId: "999" }),
  ];

  it("prefers a row that is not already linked, then the newest", () => {
    expect(resolve([posting()], AMAZON, three).merges[0].jobId).toBe("new");
  });

  it("spreads repeated alerts across the duplicates instead of stacking them", () => {
    const r = resolve(
      [posting({ linkedinJobId: "1" }), posting({ linkedinJobId: "2" })],
      AMAZON,
      three,
    );
    expect(r.merges).toHaveLength(2);
    expect(new Set(r.merges.map((m) => m.jobId)).size).toBe(2);
  });
});

describe("employers that post under another name", () => {
  // Straight from a real alert: LinkedIn said "Amazon Web Services (AWS)" where the board says
  // "Amazon". No amount of normalising bridges that -- only knowing the company does.
  const amazon = [{ id: "amazon", name: "Amazon", aliases: ["Amazon Web Services"] }];

  it("matches the alias to the board company", () => {
    const r = resolve(
      [posting({ companyName: "Amazon Web Services (AWS)", title: "SDE2 - Just Walk Out" })],
      amazon,
    );
    expect(r.leads).toHaveLength(0);
    expect(r.inserts[0].companyId).toBe("amazon");
  });

  it("leaves it a lead when no alias is configured", () => {
    const r = resolve([posting({ companyName: "Amazon Web Services (AWS)" })], AMAZON);
    expect(r.leads).toHaveLength(1);
  });

  it("still matches the company's own name", () => {
    expect(resolve([posting({ companyName: "Amazon" })], amazon).inserts).toHaveLength(1);
  });
});

describe("two board rows that normalise alike", () => {
  // Real: the board carries both "Confluent" and "Confluent (IBM)", and an alert says only
  // "Confluent". Whichever wins, it must not depend on the order rows came back in.
  const rows = [
    { id: "ibm", name: "Confluent (IBM)" },
    { id: "plain", name: "Confluent" },
  ];

  it.each([
    ["as returned", rows],
    ["reversed", rows.slice().reverse()],
  ])("picks the plainest name (%s)", (_label, companies) => {
    const r = resolve([posting({ companyName: "Confluent" })], companies);
    expect(r.inserts[0].companyId).toBe("plain");
  });
});

describe("shape", () => {
  it("is empty for an empty inbox", () => {
    expect(resolve([])).toEqual({ merges: [], inserts: [], leads: [] });
  });

  it("routes a mixed batch to all three outcomes at once", () => {
    const r = resolve(
      [
        posting({ linkedinJobId: "1" }),
        posting({ linkedinJobId: "2", title: "Frontend Engineer II" }),
        posting({ linkedinJobId: "3", companyName: "Unknown Co" }),
      ],
      AMAZON,
      [job()],
    );
    expect([r.merges.length, r.inserts.length, r.leads.length]).toEqual([1, 1, 1]);
  });
});
