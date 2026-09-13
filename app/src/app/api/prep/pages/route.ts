import { getDb } from "@/db";
import { PREP_KINDS, type PrepKind } from "@/db/schema";
import { requirePrepToken } from "@/server/auth";
import { kindOf } from "@/server/domain/prep";
import { searchPages } from "@/server/repository/prep-repo";
import { prepPageSchema } from "@/server/schemas/prep-import";
import {
  PageExistsError,
  ParentNotFoundError,
  publishPrepPage,
} from "@/server/service/prep-import";

/**
 * /api/prep/pages — the write path from a study assistant into the prep tree.
 *
 * Behind Cloudflare Access *and* the bearer token, exactly like `/api/ingest/jobs`. The MCP
 * server that calls this runs on Sarthak's own machine and holds both, so nothing here has to
 * be exposed publicly for an assistant to use it (ADR 006).
 */

function errorResponse(code: string, message: string, status: number, details?: unknown) {
  return Response.json({ error: { code, message, details } }, { status });
}

const segmentOf = (kind: PrepKind) => kindOf(kind)?.segment ?? kind;

/** GET /api/prep/pages?q=consistent+hashing&kind=system_design — "do I already have this?" */
export async function GET(request: Request): Promise<Response> {
  const auth = requirePrepToken(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (!q) return errorResponse("missing_query", "Pass ?q= to search", 400);

  const kindParam = url.searchParams.get("kind");
  if (kindParam && !(PREP_KINDS as readonly string[]).includes(kindParam)) {
    return errorResponse("invalid_kind", `kind must be one of ${PREP_KINDS.join(", ")}`, 400);
  }

  const rows = await searchPages(getDb(), q, (kindParam as PrepKind) ?? undefined);
  return Response.json({
    query: q,
    count: rows.length,
    pages: rows.map((r) => ({ ...r, url: `/prep/${segmentOf(r.kind)}/${r.slug}` })),
  });
}

/** POST /api/prep/pages — publish one page, with its resources. */
export async function POST(request: Request): Promise<Response> {
  const auth = requirePrepToken(request);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("invalid_json", "Request body is not valid JSON", 400);
  }

  const parsed = prepPageSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      "validation_failed",
      "Payload failed validation",
      400,
      parsed.error.issues.slice(0, 20),
    );
  }

  try {
    const result = await publishPrepPage(getDb(), parsed.data, segmentOf);
    return Response.json(result, { status: result.created ? 201 : 200 });
  } catch (err) {
    // Both of these are the caller's mistake and both are recoverable by the caller, so they
    // carry a message written to be read by whoever -- or whatever -- sent the request.
    if (err instanceof ParentNotFoundError) {
      return errorResponse("parent_not_found", err.message, 404);
    }
    if (err instanceof PageExistsError) {
      return errorResponse("page_exists", err.message, 409);
    }
    const causes: string[] = [];
    let current: unknown = err;
    for (let depth = 0; current && depth < 5; depth++) {
      if (current instanceof Error) {
        causes.push(`${current.name}: ${current.message.slice(0, 300)}`);
        current = current.cause;
      } else {
        causes.push(String(current).slice(0, 300));
        break;
      }
    }
    console.error("prep publish failed", { title: parsed.data.title, causes });
    return errorResponse("internal_error", "Publish failed", 500);
  }
}

export const dynamic = "force-dynamic";
