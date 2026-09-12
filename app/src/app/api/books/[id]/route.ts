import { getDb } from "@/db";
import { getById } from "@/server/repository/prep-repo";
import { driveFileId, fetchDriveFile } from "@/server/service/drive";

/**
 * GET /api/books/[id] — the PDF for a prep page, streamed out of Google Drive.
 *
 * The id is the prep page's, not Drive's. Resolving the Drive reference here rather than
 * putting it in the page keeps the file id out of the browser: the file has to be shared
 * "anyone with the link" for an anonymous fetch to work, so the id is the only thing standing
 * between the link and the book.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;

  const item = await getById(getDb(), id);
  if (!item) return new Response("No such page.", { status: 404 });

  const ref = item.content?.drive;
  if (typeof ref !== "string" || !ref) {
    return new Response("That page is not backed by a Drive file.", { status: 404 });
  }

  const fileId = driveFileId(ref);
  if (!fileId) {
    return new Response(
      "The Drive reference on that page is not a link or file id this can read.",
      { status: 422 },
    );
  }

  const file = await fetchDriveFile(fileId, request.headers.get("range"));
  if (!file.ok) return new Response(file.error, { status: file.status });

  // Drive labels a download `application/octet-stream` with an attachment disposition, which
  // makes the browser save the file instead of rendering it -- an <iframe> pointed at it shows
  // nothing at all. Say what it actually is, and say inline.
  const headers = new Headers({
    "Content-Type": "application/pdf",
    "Content-Disposition": `inline; filename="${item.slug}.pdf"`,
    // Seeking a 24 MB book depends on this being advertised.
    "Accept-Ranges": "bytes",
    // Private: the response is one user's book, behind Access, and must not sit in a shared
    // cache. Still worth caching in that user's own browser -- the bytes never change.
    "Cache-Control": "private, max-age=86400",
  });
  for (const h of ["content-length", "content-range"] as const) {
    const v = file.headers.get(h);
    if (v) headers.set(h, v);
  }

  return new Response(file.body, { status: file.status, headers });
}

// The Drive reference is read from D1 per request; nothing here is static.
export const dynamic = "force-dynamic";
