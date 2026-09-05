import { describe, expect, it } from "vitest";
import { normalizeJobUrl } from "./url";

describe("normalizeJobUrl", () => {
  it.each([
    ["https://ex.com/jobs/1", "https://ex.com/jobs/1"],
    ["https://ex.com/jobs/1/", "https://ex.com/jobs/1"],
    ["  https://ex.com/jobs/1  ", "https://ex.com/jobs/1"],
    ["https://ex.com", "https://ex.com/"],
    ["https://Ex.COM/Jobs/1/#section", "https://ex.com/Jobs/1"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeJobUrl(input)).toBe(expected);
  });

  // The bug this guards against: Greenhouse-hosted boards put the job id in the query.
  // Stripping the whole query string collapsed all 870 Databricks jobs onto one URL.
  it("preserves identity-bearing query parameters", () => {
    expect(
      normalizeJobUrl("https://databricks.com/company/careers/open-positions/job?gh_jid=7979886003"),
    ).toBe("https://databricks.com/company/careers/open-positions/job?gh_jid=7979886003");
  });

  it("keeps distinct Greenhouse jobs distinct", () => {
    const a = normalizeJobUrl("https://databricks.com/careers/job?gh_jid=111");
    const b = normalizeJobUrl("https://databricks.com/careers/job?gh_jid=222");
    expect(a).not.toBe(b);
  });

  it.each([
    "utm_source=linkedin",
    "utm_medium=social",
    "gh_src=abc123",
    "fbclid=xyz",
    "ref=newsletter",
  ])("drops the tracking parameter %s", (param) => {
    expect(normalizeJobUrl(`https://ex.com/jobs/1?gh_jid=5&${param}`)).toBe(
      "https://ex.com/jobs/1?gh_jid=5",
    );
  });

  it("sorts remaining parameters so ordering cannot change identity", () => {
    expect(normalizeJobUrl("https://ex.com/j?b=2&a=1")).toBe(
      normalizeJobUrl("https://ex.com/j?a=1&b=2"),
    );
  });

  it("lowercases the host but preserves path case, which is significant", () => {
    expect(normalizeJobUrl("https://EX.com/Jobs/AbC")).toBe("https://ex.com/Jobs/AbC");
  });

  it("is stable across repeated calls — the property dedup depends on", () => {
    const u = "https://ex.com/jobs/1?gh_jid=9&utm_source=x#f";
    expect(normalizeJobUrl(u)).toBe(normalizeJobUrl(u));
  });

  it("does not throw on an unparseable URL", () => {
    expect(() => normalizeJobUrl("not a url")).not.toThrow();
  });
});
