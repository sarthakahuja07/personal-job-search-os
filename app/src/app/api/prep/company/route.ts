import { getDb } from "@/db";
import { requirePrepToken } from "@/server/auth";
import type { Discipline } from "@/server/domain/company";
import {
  questionBankSchema,
  questionIndexSchema,
  scaffoldSchema,
} from "@/server/schemas/company";
import {
  CompanyNotFoundError,
  publishQuestionBank,
  publishQuestionIndex,
  scaffoldCompany,
} from "@/server/service/company";

/**
 * POST /api/prep/company — the company folder and its generated pages.
 *
 * One route with an `op`, rather than three. These three operations share a company, an auth
 * check and an error vocabulary, and the alternative was three files that differed by six
 * lines each.
 */

function errorResponse(code: string, message: string, status: number, details?: unknown) {
  return Response.json({ error: { code, message, details } }, { status });
}

export async function POST(request: Request): Promise<Response> {
  const auth = requirePrepToken(request);
  if (!auth.ok) return auth.response;

  let body: { op?: string } & Record<string, unknown>;
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return errorResponse("invalid_json", "Request body is not valid JSON", 400);
  }

  const db = getDb();

  try {
    switch (body.op) {
      case "scaffold": {
        const parsed = scaffoldSchema.safeParse(body);
        if (!parsed.success) {
          return errorResponse("validation_failed", "Payload failed validation", 400,
            parsed.error.issues.slice(0, 10));
        }
        const result = await scaffoldCompany(db, parsed.data.name);
        return Response.json(result, { status: result.created ? 201 : 200 });
      }

      case "question_bank": {
        const parsed = questionBankSchema.safeParse(body);
        if (!parsed.success) {
          return errorResponse("validation_failed", "Payload failed validation", 400,
            parsed.error.issues.slice(0, 10));
        }
        const result = await publishQuestionBank(
          db,
          parsed.data.company,
          parsed.data.entries.map((e) => ({
            question: e.question,
            discipline: e.discipline,
            frequency: e.frequency,
            lastAsked: e.last_asked ?? null,
          })),
        );
        return Response.json(result);
      }

      case "question_index": {
        const parsed = questionIndexSchema.safeParse(body);
        if (!parsed.success) {
          return errorResponse("validation_failed", "Payload failed validation", 400,
            parsed.error.issues.slice(0, 10));
        }
        const result = await publishQuestionIndex(
          db,
          parsed.data.company,
          parsed.data.discipline as Discipline,
          parsed.data.questions.map((q) => ({
            title: q.title,
            frequency: q.frequency,
            lastAsked: q.last_asked ?? null,
          })),
        );
        return Response.json(result);
      }

      default:
        return errorResponse(
          "unknown_op",
          `op must be one of scaffold, question_bank, question_index`,
          400,
        );
    }
  } catch (err) {
    if (err instanceof CompanyNotFoundError) {
      return errorResponse("company_not_found", err.message, 404);
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
    console.error("company op failed", { op: body.op, causes });
    return errorResponse("internal_error", "Company operation failed", 500);
  }
}

export const dynamic = "force-dynamic";
