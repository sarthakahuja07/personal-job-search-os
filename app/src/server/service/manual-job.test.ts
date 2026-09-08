import { describe, expect, it } from "vitest";

import { guessCompanyFromUrl, localeRelaxedKey, manualExternalId } from "./manual-job";

const KNOWN = [
  {
    id: "rippling",
    name: "Rippling",
    careersUrl: "https://www.rippling.com/careers/open-roles",
    websiteUrl: "https://www.rippling.com",
  },
  {
    id: "postman",
    name: "Postman",
    careersUrl: "https://boards.greenhouse.io/postman",
    websiteUrl: null,
  },
  { id: "deshaw", name: "DE Shaw", careersUrl: null, websiteUrl: null },
];

describe("manualExternalId", () => {
  // ADR 005 forbids synthesising an external id, because a crawled job always has a real source
  // id and inventing one from a title breaks dedup the moment the title is edited. A pasted link
  // has no source id at all, so the link itself is the honest identity: stable, unique per
  // posting, and never derived from editable content.
  it("is derived from the link, not the title", () => {
    const a = manualExternalId("https://x.com/jobs/123");
    const b = manualExternalId("https://x.com/jobs/123");
    expect(a).toBe(b);
    expect(a).toContain("x.com/jobs/123");
  });

  it("is marked so it can never be mistaken for a vendor id", () => {
    expect(manualExternalId("https://x.com/jobs/1")).toMatch(/^manual:/);
  });

  it("collapses links that differ only by tracking parameters", () => {
    expect(manualExternalId("https://x.com/jobs/1?utm_source=slack")).toBe(
      manualExternalId("https://x.com/jobs/1"),
    );
  });

  it("keeps links apart when the id lives in the query string", () => {
    expect(manualExternalId("https://x.com/j?gh_jid=9")).not.toBe(
      manualExternalId("https://x.com/j?gh_jid=8"),
    );
  });
});

describe("guessCompanyFromUrl", () => {
  it("matches on the hostname", () => {
    expect(
      guessCompanyFromUrl("https://www.rippling.com/careers/open-roles/abc", KNOWN),
    ).toBe("rippling");
  });

  it("matches an ATS link, where the company is in the path not the host", () => {
    expect(guessCompanyFromUrl("https://boards.greenhouse.io/postman/jobs/7", KNOWN)).toBe(
      "postman",
    );
  });

  it("matches a company name that contains a space", () => {
    expect(guessCompanyFromUrl("https://deshawindia.com/careers/x", KNOWN)).toBe("deshaw");
  });

  it("returns null rather than guessing wildly", () => {
    expect(guessCompanyFromUrl("https://example.com/jobs/1", KNOWN)).toBeNull();
  });

  it("survives a malformed link", () => {
    expect(guessCompanyFromUrl("not a url", KNOWN)).toBeNull();
  });

  // A stored careers URL can be junk; adding a job must not break because of it.
  it("survives a malformed stored company URL", () => {
    expect(
      guessCompanyFromUrl("https://example.com/x", [
        { id: "bad", name: "Bad", careersUrl: "http://[", websiteUrl: null },
      ]),
    ).toBeNull();
  });
});

describe("distinct postings at one company", () => {
  // Reported: adding a second role at a company that already had one appeared to do nothing.
  // These are the two links from IBM that prompted it — they must not collapse onto one id.
  const a = "https://careers.ibm.com/en_IN/careers/JobDetail?jobId=129283&source=WEB_Search_INDIA";
  const b = "https://careers.ibm.com/en_IN/careers/JobDetail?jobId=127254&source=WEB_Search_INDIA";

  it("keeps two different postings apart", () => {
    expect(manualExternalId(a)).not.toBe(manualExternalId(b));
  });

  it("ignores the tracking parameter when deciding identity", () => {
    expect(manualExternalId(a)).toBe(
      manualExternalId("https://careers.ibm.com/en_IN/careers/JobDetail?jobId=129283"),
    );
  });

  it("keeps the id parameter, which is the identity itself", () => {
    expect(manualExternalId(a)).toContain("jobId=129283");
  });
});

describe("locale-variant dedup (manual path only)", () => {
  // IBM serves the same requisition under /en_IN/ and /en_US/. Pasting whichever you opened
  // created a second copy of a job the crawler already had.
  const IN = "https://careers.ibm.com/en_IN/careers/JobDetail?jobId=129283";
  const US = "https://careers.ibm.com/en_US/careers/JobDetail?jobId=129283";

  it("treats the two locales as the same posting", () => {
    expect(localeRelaxedKey(IN)).toBe(localeRelaxedKey(US));
  });

  it.each([
    ["en-in", "https://x.com/en-in/jobs/7"],
    ["fr_FR", "https://x.com/fr_FR/jobs/7"],
  ])("also strips %s", (_label, url) => {
    expect(localeRelaxedKey(url)).toBe(localeRelaxedKey("https://x.com/jobs/7"));
  });

  // The whole point of keeping this off normalizeJobUrl: it must never merge distinct jobs.
  it("keeps different requisitions apart", () => {
    expect(localeRelaxedKey(IN)).not.toBe(
      localeRelaxedKey("https://careers.ibm.com/en_US/careers/JobDetail?jobId=127254"),
    );
  });

  it("does not strip a real path segment that merely looks short", () => {
    // "job" and "abc" are three letters, not a locale, and must survive.
    expect(localeRelaxedKey("https://x.com/job/abc")).toContain("job/abc");
  });

  it("keeps different hosts apart", () => {
    expect(localeRelaxedKey("https://a.com/en_US/j/1")).not.toBe(
      localeRelaxedKey("https://b.com/en_US/j/1"),
    );
  });

  it("leaves the crawler's identity function untouched", () => {
    // normalizeJobUrl is shared with Python and is what dedupes 400+ crawled jobs. Relaxing it
    // is how 869 of Databricks' 870 jobs once collapsed onto one URL.
    expect(manualExternalId(IN)).not.toBe(manualExternalId(US));
  });

  it("survives a malformed URL", () => {
    expect(localeRelaxedKey("not a url")).toBe("not a url");
  });
});
