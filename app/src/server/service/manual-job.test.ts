import { describe, expect, it } from "vitest";

import { guessCompanyFromUrl, manualExternalId } from "./manual-job";

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
