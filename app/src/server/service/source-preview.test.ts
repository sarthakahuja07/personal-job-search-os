import { afterEach, describe, expect, it, vi } from "vitest";

import { previewSource } from "./source-preview";

function mockFetch(handler: (url: string, init?: RequestInit) => unknown) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const body = handler(String(url), init);
    if (body instanceof Error) throw body;
    return { ok: true, status: 200, json: async () => body } as Response;
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe("detection", () => {
  it("reports an unrecognised URL as manual rather than guessing", async () => {
    const p = await previewSource("https://example.com/careers");
    expect(p.detection).toBeNull();
    expect(p.ok).toBe(false);
    expect(p.error).toMatch(/manual check/);
  });

  it("requires a URL", async () => {
    expect((await previewSource("   ")).detection).toBeNull();
  });
});

describe("a board that answers with jobs", () => {
  it("confirms Greenhouse and shows real titles", async () => {
    mockFetch(() => ({ jobs: [{ title: "Software Engineer II" }, { title: "SDE 2" }] }));
    const p = await previewSource("https://boards.greenhouse.io/postman");
    expect(p.ok).toBe(true);
    expect(p.detection?.label).toBe("Greenhouse");
    expect(p.sample).toEqual(["Software Engineer II", "SDE 2"]);
  });

  it("reads Lever's bare array", async () => {
    mockFetch(() => [{ text: "Backend Engineer" }]);
    const p = await previewSource("https://jobs.lever.co/zeta");
    expect(p.ok).toBe(true);
    expect(p.sample).toEqual(["Backend Engineer"]);
  });

  it("prefers SmartRecruiters' reported total over the page size", async () => {
    mockFetch(() => ({ content: [{ name: "Engineer" }], totalFound: 68 }));
    const p = await previewSource("https://careers.smartrecruiters.com/ServiceNow");
    expect(p.total).toBe(68);
  });

  it("never asks Workday for more than 20 rows", async () => {
    // Verified live: Workday returns HTTP 400 above 20, so a preview that asked for more would
    // report a broken board for a perfectly good tenant.
    let sent: Record<string, unknown> = {};
    mockFetch((_url, init) => {
      sent = JSON.parse(String(init?.body ?? "{}"));
      return { jobPostings: [{ title: "Engineer II" }], total: 2000 };
    });
    const p = await previewSource("https://visa.wd5.myworkdayjobs.com/Visa");
    expect(sent.limit).toBeLessThanOrEqual(20);
    expect(p.ok).toBe(true);
    expect(p.total).toBe(2000);
  });
});

describe("a board that answers with nothing", () => {
  // The case this whole endpoint exists for. SmartRecruiters returns HTTP 200 with an empty
  // list for any company id at all -- probing "apple", "wintwealth" and "ringg" all came back
  // 200 -- so a typo is indistinguishable from a real board without fetching it.
  it("refuses to call an empty board proven", async () => {
    mockFetch(() => ({ content: [], totalFound: 0 }));
    const p = await previewSource("https://careers.smartrecruiters.com/nonsense");
    expect(p.detection?.label).toBe("SmartRecruiters");
    expect(p.ok).toBe(false);
    expect(p.error).toMatch(/no jobs/);
  });

  it("says so for a mistyped Greenhouse token too", async () => {
    mockFetch(() => ({ jobs: [] }));
    const p = await previewSource("https://boards.greenhouse.io/ripling");
    expect(p.ok).toBe(false);
    expect(p.error).toMatch(/identifier is wrong/);
  });
});

describe("a board that does not answer", () => {
  it("reports an HTTP failure in words rather than throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404 }) as Response));
    const p = await previewSource("https://boards.greenhouse.io/gone");
    expect(p.ok).toBe(false);
    expect(p.error).toMatch(/HTTP 404/);
    expect(p.detection?.label).toBe("Greenhouse");
  });

  it("survives a network error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("connection reset");
    }));
    const p = await previewSource("https://jobs.ashbyhq.com/sarvam");
    expect(p.ok).toBe(false);
    expect(p.error).toMatch(/connection reset/);
  });

  it("still reports what it detected, so the failure is attributable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("boom");
    }));
    expect((await previewSource("https://jobs.lever.co/zeta")).detection?.sourceTier).toBe(1);
  });
});
