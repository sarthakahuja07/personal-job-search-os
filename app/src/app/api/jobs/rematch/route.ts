import { getDb } from "@/db";
import { requireIngestToken } from "@/server/auth";
import { rematchJobs } from "@/server/service/rematch";

/**
 * POST /api/jobs/rematch
 *
 * Re-applies the current match rules to jobs already stored. Call repeatedly while the response
 * reports `truncated: true`.
 */
export async function POST(request: Request): Promise<Response> {
  const auth = requireIngestToken(request);
  if (!auth.ok) return auth.response;

  try {
    const result = await rematchJobs(getDb());
    return Response.json(result);
  } catch (err) {
    console.error("rematch failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return Response.json(
      { error: { code: "internal_error", message: "Rematch failed" } },
      { status: 500 },
    );
  }
}
