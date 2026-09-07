import { describe, expect, it } from "vitest";

import { describeConfig, detectSource, validateConfig } from "./source-detect";

describe("detectSource", () => {
  // These are the exact URLs of companies actually being crawled, so a regression here would
  // break the real board rather than a hypothetical one.
  it.each([
    ["https://boards.greenhouse.io/databricks", "greenhouse", { boardToken: "databricks" }],
    ["https://job-boards.greenhouse.io/postman", "greenhouse", { boardToken: "postman" }],
    ["https://jobs.lever.co/zeta", "lever", { slug: "zeta" }],
    ["https://jobs.ashbyhq.com/confluent", "ashby", { slug: "confluent" }],
    [
      "https://careers.smartrecruiters.com/ServiceNow",
      "smartrecruiters",
      { companyId: "ServiceNow" },
    ],
  ])("detects %s", (url, sourceType, config) => {
    const d = detectSource(url);
    expect(d?.sourceType).toBe(sourceType);
    expect(d?.config).toEqual(config);
  });

  it.each([
    [
      "https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite",
      { tenant: "nvidia", dataCenter: "wd5", site: "NVIDIAExternalCareerSite" },
    ],
    [
      "https://visa.wd5.myworkdayjobs.com/Visa",
      { tenant: "visa", dataCenter: "wd5", site: "Visa" },
    ],
    [
      "https://salesforce.wd12.myworkdayjobs.com/External_Career_Site",
      { tenant: "salesforce", dataCenter: "wd12", site: "External_Career_Site" },
    ],
    [
      "https://adobe.wd5.myworkdayjobs.com/en-US/external_experienced",
      { tenant: "adobe", dataCenter: "wd5", site: "external_experienced" },
    ],
  ])("detects Workday %s", (url, config) => {
    const d = detectSource(url);
    expect(d?.sourceType).toBe("workday");
    expect(d?.config).toEqual(config);
    expect(d?.sourceTier).toBe(2);
  });

  it("strips a locale segment from a Workday URL rather than treating it as the site", () => {
    expect(detectSource("https://adobe.wd5.myworkdayjobs.com/en-US/external_experienced")?.config.site)
      .toBe("external_experienced");
  });

  // An honest null becomes a "manual" company that shows up as something to check by hand.
  // A wrong guess would produce an adapter that fails quietly, which is far worse.
  it.each([
    "https://www.moveworks.com/us/en/company/careers",
    "https://careers.qualcomm.com/careers",
    "https://www.google.com/about/careers",
    "not a url",
    "",
  ])("returns null for %s rather than guessing", (url) => {
    expect(detectSource(url)).toBeNull();
  });

  it("tolerates surrounding whitespace from a paste", () => {
    expect(detectSource("  https://jobs.lever.co/zeta  ")?.config).toEqual({ slug: "zeta" });
  });
});

describe("validateConfig", () => {
  it("accepts a complete config", () => {
    expect(validateConfig("greenhouse", { boardToken: "databricks" })).toEqual([]);
    expect(
      validateConfig("workday", { tenant: "nvidia", dataCenter: "wd5", site: "X" }),
    ).toEqual([]);
  });

  it("names every missing Workday field, since the shard is the unguessable one", () => {
    const errors = validateConfig("workday", { tenant: "nvidia" });
    expect(errors).toHaveLength(2);
    expect(errors.join(" ")).toContain("dataCenter");
    expect(errors.join(" ")).toContain("site");
  });

  it("requires nothing of a manual company", () => {
    expect(validateConfig("manual", {})).toEqual([]);
  });
});

describe("describeConfig", () => {
  it("summarises each source type readably", () => {
    expect(describeConfig("greenhouse", { boardToken: "roku" })).toBe("roku");
    expect(
      describeConfig("workday", { tenant: "visa", dataCenter: "wd5", site: "Visa" }),
    ).toBe("visa.wd5/Visa");
    expect(describeConfig("manual", {})).toBe("checked by hand");
  });

  it("flags an incomplete Workday config instead of rendering undefined", () => {
    expect(describeConfig("workday", { tenant: "visa" })).toBe("incomplete");
  });
});
