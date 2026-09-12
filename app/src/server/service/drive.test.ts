/**
 * Reading a book out of Drive.
 *
 * The interesting cases are not the happy path but the two ways Drive fails *quietly*: an
 * unshared file answered with a 200 and a sign-in page, and a large file answered with a 200
 * and a virus-scan interstitial. Both are HTML wearing a success code, and streaming either
 * one into a PDF frame produces a blank rectangle -- the exact failure mode this project
 * refuses to ship, because it is indistinguishable from a missing book.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { driveFileId, fetchDriveFile } from "./drive";

describe("driveFileId", () => {
  const id = "1RelBYYeUJo7q8ehyDLzMx37j6LlmOf1W";

  it("reads the share link the Drive menu produces", () => {
    expect(driveFileId(`https://drive.google.com/file/d/${id}/view?usp=drive_link`)).toBe(id);
  });

  it("reads the older open and uc forms", () => {
    expect(driveFileId(`https://drive.google.com/open?id=${id}`)).toBe(id);
    expect(driveFileId(`https://drive.google.com/uc?export=download&id=${id}`)).toBe(id);
  });

  it("accepts a bare id, so a pasted id needs no special case", () => {
    expect(driveFileId(id)).toBe(id);
    expect(driveFileId(`  ${id}  `)).toBe(id);
  });

  it("rejects things that are not ids rather than inventing one", () => {
    expect(driveFileId("")).toBeNull();
    expect(driveFileId("not a link")).toBeNull();
    // Short enough to be a word; an id is never this short.
    expect(driveFileId("https://drive.google.com/file/d/abc/view")).toBeNull();
  });
});

describe("fetchDriveFile", () => {
  afterEach(() => vi.unstubAllGlobals());

  const stub = (r: Partial<Response> & { headers?: Headers }) =>
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/octet-stream" }),
      body: null,
      ...r,
    } as Response));

  it("passes a Range through, so a 24 MB book can be seeked", async () => {
    const spy = vi.fn().mockResolvedValue({
      ok: true,
      status: 206,
      headers: new Headers({ "content-type": "application/pdf" }),
      body: null,
    } as Response);
    vi.stubGlobal("fetch", spy);

    const res = await fetchDriveFile("abc", "bytes=0-1023");

    expect(res.ok).toBe(true);
    const init = spy.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Range).toBe("bytes=0-1023");
  });

  it("treats a 206 as success, not as a failure", async () => {
    stub({ ok: false, status: 206 });
    expect((await fetchDriveFile("abc", "bytes=0-10")).ok).toBe(true);
  });

  it("refuses an HTML body served with a 200 instead of framing a blank box", async () => {
    stub({ headers: new Headers({ "content-type": "text/html; charset=utf-8" }) });

    const res = await fetchDriveFile("abc");

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(403);
      expect(res.error).toMatch(/not shared publicly/i);
    }
  });

  it("says the file is missing on a 404 rather than reporting a generic upstream error", async () => {
    stub({ ok: false, status: 404 });

    const res = await fetchDriveFile("abc");

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(404);
      expect(res.error).toMatch(/anyone with the link/i);
    }
  });

  it("survives Drive being unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));

    const res = await fetchDriveFile("abc");

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(502);
  });

  it("pre-answers the virus-scan interstitial rather than paying a second round trip", async () => {
    const spy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/pdf" }),
      body: null,
    } as Response);
    vi.stubGlobal("fetch", spy);

    await fetchDriveFile("abc");

    expect(String(spy.mock.calls[0][0])).toContain("confirm=t");
  });
});
