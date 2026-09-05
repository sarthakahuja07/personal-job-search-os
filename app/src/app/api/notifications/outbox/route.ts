import { getDb } from "@/db";
import { requireIngestToken } from "@/server/auth";
import { listPending, notifyEmail } from "@/server/repository/notifications-repo";

/**
 * GET /api/notifications/outbox
 *
 * Pending notifications for the Actions drainer, plus the address to send them to. The app never
 * sends email itself: Workers cannot practically speak SMTP, so delivery happens on the runner
 * (ADR 007).
 */
export async function GET(request: Request): Promise<Response> {
  const auth = requireIngestToken(request);
  if (!auth.ok) return auth.response;

  const db = getDb();
  const [pending, to] = await Promise.all([listPending(db, 100), notifyEmail(db)]);

  return Response.json({
    notify_email: to,
    count: pending.length,
    notifications: pending.map((n) => ({
      id: n.id,
      dedup_key: n.dedupKey,
      type: n.notificationType,
      attempts: n.attempts,
      job: n.title
        ? {
            id: n.jobId,
            title: n.title,
            company: n.companyName,
            location: n.location,
            url: n.jobUrl,
            match_score: n.matchScore,
            match_reason: n.matchReason,
          }
        : null,
    })),
  });
}
