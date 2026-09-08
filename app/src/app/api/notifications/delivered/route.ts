import { z } from "zod";

import { getDb } from "@/db";
import { emailDigests } from "@/db/schema";
import { requireIngestToken } from "@/server/auth";
import { markFailed, markSent } from "@/server/repository/notifications-repo";

const schema = z.object({
  sent_ids: z.array(z.string()).default([]),
  failed_ids: z.array(z.string()).default([]),
  error: z.string().nullish(),
  // What actually went out. Optional so an older drainer keeps working -- the confirmation
  // matters more than the record of it.
  subject: z.string().nullish(),
  body: z.string().nullish(),
  recipient: z.string().nullish(),
});

/**
 * POST /api/notifications/delivered
 *
 * Batched confirmation from the drainer. Batched rather than per-notification because D1 allows
 * only 50 queries per invocation, and because a digest covering 16 jobs is one delivery event,
 * not 16.
 */
export async function POST(request: Request): Promise<Response> {
  const auth = requireIngestToken(request);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: { code: "invalid_json", message: "Body is not valid JSON" } },
      { status: 400 },
    );
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: { code: "validation_failed", message: "Invalid payload" } },
      { status: 400 },
    );
  }

  const db = getDb();
  const { sent_ids, failed_ids, error } = parsed.data;

  if (sent_ids.length) {
    await markSent(db, sent_ids);
    // Store the email verbatim rather than the ingredients for one. A digest rebuilt later from
    // notification rows would silently diverge the first time the template changed.
    if (parsed.data.subject && parsed.data.body) {
      await db.insert(emailDigests).values({
        id: crypto.randomUUID(),
        subject: parsed.data.subject,
        bodyText: parsed.data.body,
        recipient: parsed.data.recipient ?? null,
        notificationCount: sent_ids.length,
        sentAt: new Date(),
      });
    }
  }
  if (failed_ids.length) {
    await markFailed(db, failed_ids, error ?? "delivery failed");
  }

  return Response.json({ sent: sent_ids.length, failed: failed_ids.length });
}
