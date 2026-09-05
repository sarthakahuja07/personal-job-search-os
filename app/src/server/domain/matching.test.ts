import { describe, expect, it } from "vitest";

import {
  DEFAULT_MATCH_RULES,
  matchJob,
  matchLocation,
  matchTitle,
  parseRequiredYears,
} from "./matching";

const BLR = "Bengaluru, Karnataka, India";

describe("matchTitle", () => {
  it.each([
    ["Software Engineer II", "Software Engineer II"],
    ["Software Engineer 2", "Software Engineer II"],
    ["SDE 2", "SDE 2"],
    ["SDE-II", "SDE 2"],
    ["SDE II", "SDE 2"],
    ["SWE 2", "SWE 2"],
    ["Software Development Engineer II", "Software Engineer II"],
    ["Software Engineer, L4", "L4 (Google SDE-2 equivalent)"],
    ["Member of Technical Staff 2", "MTS 2"],
  ])("accepts %s", (title, label) => {
    const r = matchTitle(title);
    expect(r.passed).toBe(true);
    expect(r.label).toBe(label);
  });

  it.each([
    "Senior Software Engineer",
    "Sr. Software Engineer",
    "Staff Software Engineer",
    "Principal Engineer",
    "Software Engineer III",
    "Software Engineer, L5",
    "Engineering Manager - OpenBMC Platform", // a real NVIDIA posting
    "Software Engineer Intern",
    "New Grad Software Engineer",
    "SDE 1",
    "SDET",
    "Product Manager",
    "Solutions Engineer",
    "Technical Writer",
  ])("rejects %s", (title) => {
    expect(matchTitle(title).passed).toBe(false);
  });

  // Regression cases taken from live NVIDIA / Databricks postings.
  it.each([
    "Software Engineer, Linux Graphics",
    "System Software Engineer, Engineering Workflow Platform",
    "Frontend Web Software Engineer, NGC",
    "SONiC Software Engineer - Python",
  ])("accepts real-world suffixed title %s", (title) => {
    // An anchored ^software engineer$ pattern silently rejected 194 of 1334 live postings.
    expect(matchTitle(title).passed).toBe(true);
  });

  it.each([
    "Quality Assurance Software Developer Engineer in Test, GeForce GPU",
    "ASIC Verification Engineer - Clocks",
    "PCB Design Layout Engineer",
    "DFT Methodology Engineer",
    "Senior Package Layout Engineer - Hardware",
    "GPU Architect",
  ])("rejects non-backend real-world title %s", (title) => {
    expect(matchTitle(title).passed).toBe(false);
  });

  it("prefers the highest-scoring pattern when several match", () => {
    // "Backend Engineer II" matches both the generic backend rule and Engineer II.
    const r = matchTitle("Backend Engineer II");
    expect(r.passed).toBe(true);
    expect(r.score).toBe(90);
  });

  it("keeps unlevelled titles, which startups use, at a lower score", () => {
    const r = matchTitle("Software Engineer");
    expect(r.passed).toBe(true);
    expect(r.score).toBeLessThan(matchTitle("Software Engineer II").score);
  });
});

describe("parseRequiredYears", () => {
  it.each([
    ["3+ years of experience building distributed systems", 3],
    ["4+ years of professional experience", 4],
    ["Minimum of 8 years in software development", 8],
    ["At least 5 years of relevant experience", 5],
    ["<p>2-4 years of industry experience</p>", 2],
    ["Experience: 6 years", 6],
  ])("parses %s -> %i", (text, expected) => {
    expect(parseRequiredYears(text)).toBe(expected);
  });

  it("returns null when no requirement is stated", () => {
    expect(parseRequiredYears("We value curiosity and ownership.")).toBeNull();
    expect(parseRequiredYears(null)).toBeNull();
  });

  it("takes the smallest figure when several are mentioned", () => {
    // Leniency is deliberate: a false negative loses the role entirely.
    expect(
      parseRequiredYears("3+ years with Go. 8+ years of overall experience preferred."),
    ).toBe(3);
  });

  it("ignores implausible numbers", () => {
    expect(parseRequiredYears("Founded 2011 years ago experience")).toBeNull();
  });
});

describe("matchLocation", () => {
  it.each([
    ["Bengaluru, India", "Bangalore"],
    ["Bangalore", "Bangalore"],
    ["Gurugram, Haryana", "Gurgaon"],
    ["Remote - India", "Remote"],
    ["Hyderabad, Telangana", "Hyderabad"],
  ])("maps %s -> %s", (input, name) => {
    expect(matchLocation(input).matched?.name).toBe(name);
  });

  it("rejects locations outside the allow list", () => {
    expect(matchLocation("US, CA, Santa Clara").matched).toBeNull();
    expect(matchLocation("US, CA, Santa Clara").unknown).toBe(false);
  });

  // Regression: live NVIDIA data returned "Italy, Remote", "Canada, Remote" and "US, FL, Remote",
  // all of which matched a naive "remote" alias despite being unreachable roles.
  it.each([
    "Italy, Remote",
    "Canada, Remote",
    "US, FL, Remote",
    "Australia, Remote",
    "UK, Remote",
    "Germany, Munich",
  ])("rejects foreign location %s even when it says Remote", (location) => {
    expect(matchLocation(location).matched).toBeNull();
    expect(matchLocation(location).unknown).toBe(false);
  });

  it.each(["India, Remote", "Remote - India", "Remote", "Bengaluru, India"])(
    "still accepts %s",
    (location) => {
      expect(matchLocation(location).matched).not.toBeNull();
    },
  );

  it("reports an empty location as unknown rather than rejected", () => {
    expect(matchLocation(null).unknown).toBe(true);
    expect(matchLocation("").unknown).toBe(true);
  });

  it("picks the highest-priority location when a posting lists several", () => {
    expect(matchLocation("Hyderabad or Bengaluru").matched?.name).toBe("Bangalore");
  });
});

describe("matchJob", () => {
  it("accepts an ideal role", () => {
    const r = matchJob({
      title: "Software Engineer II",
      location: BLR,
      description: "3+ years of experience.",
    });
    expect(r.isRelevant).toBe(true);
    expect(r.score).toBe(140); // 100 title + 40 Bangalore
    expect(r.locationPriority).toBe(1);
    expect(r.reason).toContain("fits");
  });

  it("rejects an out-of-scope location even with a perfect title", () => {
    const r = matchJob({
      title: "Software Engineer II",
      location: "US, CA, Santa Clara",
      description: "3+ years",
    });
    expect(r.isRelevant).toBe(false);
    expect(r.reason).toContain("not in the allowed list");
  });

  it("rejects a role demanding far more experience", () => {
    const r = matchJob({
      title: "Software Engineer II",
      location: BLR,
      description: "Minimum of 8 years of experience required.",
    });
    expect(r.isRelevant).toBe(false);
    expect(r.requiredYears).toBe(8);
  });

  it("keeps a slightly-over role, with a penalty rather than a rejection", () => {
    const r = matchJob({
      title: "Software Engineer II",
      location: BLR,
      description: "5+ years of experience.",
    });
    expect(r.isRelevant).toBe(true);
    expect(r.score).toBe(130); // 140 - 10 for one year over
    expect(r.reason).toContain("above target");
  });

  it("keeps a job whose description states no experience requirement", () => {
    const r = matchJob({ title: "SDE 2", location: BLR, description: null });
    expect(r.isRelevant).toBe(true);
    expect(r.reason).toContain("experience not stated");
  });

  it("keeps a job with no location rather than silently dropping it", () => {
    const r = matchJob({ title: "SDE 2", location: null });
    expect(r.isRelevant).toBe(true);
    expect(r.locationPriority).toBeNull();
  });

  it("ranks the four locations in Sarthak's stated order", () => {
    const at = (location: string) =>
      matchJob({ title: "Software Engineer II", location });
    const blr = at("Bengaluru");
    const ggn = at("Gurugram");
    const rem = at("Remote");
    const hyd = at("Hyderabad");

    expect([blr, ggn, rem, hyd].map((r) => r.locationPriority)).toEqual([1, 2, 3, 4]);
    expect(blr.score).toBeGreaterThan(ggn.score);
    expect(ggn.score).toBeGreaterThan(rem.score);
    expect(rem.score).toBeGreaterThan(hyd.score);
  });

  it("always explains itself", () => {
    for (const job of [
      { title: "Software Engineer II", location: BLR },
      { title: "Senior Software Engineer", location: BLR },
      { title: "Software Engineer II", location: "Dublin, Ireland" },
    ]) {
      expect(matchJob(job).reason.length).toBeGreaterThan(0);
    }
  });

  it("is deterministic", () => {
    const job = { title: "SDE 2", location: BLR, description: "4+ years" };
    expect(matchJob(job)).toEqual(matchJob(job));
  });

  it("honours a caller-supplied rule set instead of the default", () => {
    const strict = {
      ...DEFAULT_MATCH_RULES,
      location: { ...DEFAULT_MATCH_RULES.location, unknownPasses: false },
    };
    expect(matchJob({ title: "SDE 2", location: null }, strict).isRelevant).toBe(false);
  });
});

// Sarthak's background is Go/Python backend and distributed systems. Security and networking
// roles match the level patterns cleanly -- these are all real titles that scored as SDE-2 --
// but they are a different discipline and he does not want them surfaced.
describe("matchTitle — security and networking are excluded", () => {
  it.each([
    "Cloud Network Engineer II",
    "Product Security Engineer II",
    "SIEM & SecOps Engineer II",
    "Software Engineer, Routing",
    "Security Software Engineer, Vulnerability Operations",
    "Infiniband Network Engineer",
    "Software Engineer II, Threat Detection",
    "Cryptography Engineer II",
    "Wireless Software Engineer 2",
  ])("rejects %s", (title) => {
    expect(matchTitle(title).passed).toBe(false);
  });

  it.each([
    "Software Engineer II",
    "Backend Engineer",
    "SDE 2",
    "Member of Technical Staff - II",
    "Software Engineer 2",
    "Platform Engineer",
    "Distributed Systems Engineer II",
  ])("still accepts core backend title %s", (title) => {
    expect(matchTitle(title).passed).toBe(true);
  });
});
