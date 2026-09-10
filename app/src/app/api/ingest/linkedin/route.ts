import { getDb } from "@/db";
import { requireIngestToken } from "@/server/auth";
import { linkedinIngestSchema } from "@/server/schemas/linkedin";
import { MAX_MERGES_PER_REQUEST } from "@/server/repository/linkedin-repo";
import { ingestLinkedInPostings } from "@/server/service/linkedin-ingest";

/**
 * POST /api/ingest/linkedin — postings read out of LinkedIn's alert mail.
 *
 * Returns the inserts it could not apply itself, grouped by company, for the crawler to POST
 * through /api/ingest/jobs. See service/linkedin-ingest.ts for why that round trip exists.
 */

function errorResponse(code: string, message: string, status: number, details?: unknown) {
  return Response.json({ error: { code, message, details } }, { status });
}

export async function POST(request: Request): Promise<Response> {
  const auth = requireIngestToken(request);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("invalid_json", "Request body is not valid JSON", 400);
  }

  const parsed = linkedinIngestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("invalid_payload", "Payload failed validation", 422, {
      issues: parsed.error.issues.slice(0, 10),
    });
  }

  // Merges are single-row UPDATEs, so a large batch would blow D1's per-invocation query
  // budget. Refusing is better than half-applying: a partial merge leaves the board looking
  // finished while some openings still carry no LinkedIn link.
  if (parsed.data.postings.length > MAX_MERGES_PER_REQUEST * 4) {
    return errorResponse(
      "batch_too_large",
      `Send at most ${MAX_MERGES_PER_REQUEST * 4} postings per request`,
      413,
    );
  }

  try {
    const result = await ingestLinkedInPostings(getDb(), parsed.data);
    return Response.json(result);
  } catch (error) {
    return errorResponse(
      "ingest_failed",
      error instanceof Error ? error.message : "Unknown error",
      500,
    );
  }
}
