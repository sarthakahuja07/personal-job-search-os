import { getDb } from "@/db";
import { requireIngestToken } from "@/server/auth";
import { ingestPayloadSchema } from "@/server/schemas/ingest";
import {
  CompanyInactiveError,
  CompanyNotFoundError,
  ingestJobs,
} from "@/server/service/ingest";

/** POST /api/ingest/jobs — the single write path from crawler to database. */

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

  const parsed = ingestPayloadSchema.safeParse(body);
  if (!parsed.success) {
    // Reject the whole payload rather than ingesting part of it. Partial ingestion of a
    // malformed crawl is worse than none: it looks like success while losing jobs.
    return errorResponse(
      "validation_failed",
      "Payload failed validation",
      400,
      parsed.error.issues.slice(0, 20),
    );
  }

  try {
    const result = await ingestJobs(getDb(), parsed.data);
    return Response.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof CompanyNotFoundError) {
      return errorResponse("company_not_found", `Unknown company ${err.message}`, 404);
    }
    if (err instanceof CompanyInactiveError) {
      return errorResponse("company_inactive", `Company ${err.message} is inactive`, 409);
    }
    // Log the nested cause, not just the wrapper. Drizzle wraps driver errors in a generic
    // "Failed query" message; the actual D1 reason lives in err.cause and is the only part
    // that says *why*. A 500 you cannot diagnose is the failure mode this project exists to avoid.
    const causeChain: string[] = [];
    let current: unknown = err;
    for (let depth = 0; current && depth < 5; depth++) {
      if (current instanceof Error) {
        causeChain.push(`${current.name}: ${current.message.slice(0, 300)}`);
        current = current.cause;
      } else {
        causeChain.push(String(current).slice(0, 300));
        break;
      }
    }
    console.error("ingest failed", {
      runId: parsed.data.run_id,
      companyId: parsed.data.company_id,
      jobs: parsed.data.jobs.length,
      causes: causeChain,
    });
    return errorResponse("internal_error", "Ingest failed", 500);
  }
}
