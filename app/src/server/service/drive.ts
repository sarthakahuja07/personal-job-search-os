/**
 * Reading a book out of Google Drive.
 *
 * The PDFs are deliberately gitignored -- they are paid books and do not belong in a
 * repository -- which meant they only ever existed on the laptop that deployed. A deploy from
 * GitHub Actions checks out a tree with no PDFs in it, ships an assets directory without them,
 * and every book 404s until someone redeploys by hand. Drive holds the file instead, so a
 * deploy from anywhere serves the same book.
 *
 * The bytes are proxied rather than framed. Drive's own `/preview` viewer would be one line,
 * but it puts the file id in the page, replaces the browser's PDF reader with Google's, and
 * makes a third party's uptime a page dependency -- the same class of problem as the notes
 * rate limiting. Proxying keeps the reader, keeps the id server-side, and keeps the whole
 * thing behind Cloudflare Access.
 *
 * The file still has to be shared "anyone with the link" for this to work: Drive will not hand
 * an anonymous fetch a private file, and the Worker has no Google credentials. Anyone who
 * learns the id can therefore read the book. That is a real widening of access compared with
 * a file that sat only in this deployment, and it is the reason the id is never rendered.
 */

const UA = "job-search-os (personal library)";

/** Drive's current direct-download host. `drive.google.com/uc` still redirects here. */
const DOWNLOAD = "https://drive.usercontent.google.com/download";

/**
 * The file id inside whatever Drive handed you.
 *
 * Accepts the three shapes a share menu produces -- `/file/d/<id>/view`, `open?id=<id>` and
 * `uc?id=<id>` -- plus a bare id, so a setting can be pasted rather than parsed by hand.
 */
export function driveFileId(ref: string): string | null {
  const s = ref.trim();
  if (!s) return null;

  // A bare id. Drive ids are base64url-ish and comfortably longer than 20 characters; the
  // length floor is what stops a stray word being treated as an id.
  if (/^[A-Za-z0-9_-]{20,}$/.test(s)) return s;

  const patterns = [/\/file\/d\/([A-Za-z0-9_-]{20,})/, /[?&]id=([A-Za-z0-9_-]{20,})/];
  for (const p of patterns) {
    const m = s.match(p);
    if (m) return m[1];
  }
  return null;
}

export type DriveFile =
  | { ok: true; body: ReadableStream<Uint8Array> | null; status: number; headers: Headers }
  | { ok: false; error: string; status: number };

/**
 * Fetch a public Drive file, passing a Range through so the PDF reader can seek.
 *
 * Without Range the browser's viewer has to pull all 24 MB before it paints page one, and
 * jumping to a chapter pulls them again.
 */
export async function fetchDriveFile(id: string, range?: string | null): Promise<DriveFile> {
  // `confirm=t` pre-answers the "Google can't scan this file for viruses" interstitial that
  // Drive serves above roughly 25 MB. Sending it always costs nothing on a small file and
  // avoids a second round trip on a large one.
  const url = `${DOWNLOAD}?id=${encodeURIComponent(id)}&export=download&confirm=t`;

  const headers: Record<string, string> = { "User-Agent": UA };
  if (range) headers.Range = range;

  let r: Response;
  try {
    r = await fetch(url, { headers, redirect: "follow" });
  } catch {
    return { ok: false, error: "Could not reach Google Drive.", status: 502 };
  }

  if (!r.ok && r.status !== 206) {
    return {
      ok: false,
      error:
        r.status === 404
          ? "Drive does not have that file. Check the link, and that sharing is set to anyone with the link."
          : `Google Drive returned ${r.status}.`,
      status: r.status === 404 ? 404 : 502,
    };
  }

  // Drive answers an unshared file with a 200 and an HTML sign-in page. Streaming that into an
  // <iframe> that expects a PDF renders a blank box -- indistinguishable from a missing file,
  // which is exactly the failure this project refuses to ship. Catch it and say so.
  const type = r.headers.get("content-type") ?? "";
  if (type.includes("text/html")) {
    return {
      ok: false,
      error:
        "Drive returned a web page instead of the file, which means it is not shared publicly. " +
        "Open the file in Drive, Share, and set General access to anyone with the link.",
      status: 403,
    };
  }

  return { ok: true, body: r.body, status: r.status, headers: r.headers };
}
