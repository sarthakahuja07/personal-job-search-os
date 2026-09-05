import { Badge, Card, EmptyState, PageHeader, cx } from "@/components/ui";
import { getDb } from "@/db";
import { listRecent } from "@/server/repository/notifications-repo";

export const dynamic = "force-dynamic";

const STATUS_TONE = {
  sent: "fresh",
  pending: "warn",
  failed: "danger",
} as const;

function when(date: Date | null): string {
  if (!date) return "—";
  const mins = Math.floor((Date.now() - date.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default async function NotificationsPage() {
  const rows = await listRecent(getDb(), 100);
  const pending = rows.filter((r) => r.status === "pending").length;
  const sent = rows.filter((r) => r.status === "sent").length;

  return (
    <div>
      <PageHeader
        title="Notifications"
        subtitle={
          <>
            <span className="tnum text-ink">{sent}</span> sent ·{" "}
            <span className="tnum text-ink">{pending}</span> pending delivery
          </>
        }
      />

      <Card className="mb-5 px-4 py-3">
        <p className="text-xs leading-relaxed text-ink-dim">
          Queued when a crawl finds a new matching role, then sent as one digest by the
          scheduled job. A unique key per job makes a duplicate impossible at the database
          level, so a role can only ever be announced once — however many times the crawl runs.
        </p>
      </Card>

      {rows.length === 0 ? (
        <EmptyState
          title="Nothing queued yet"
          body="Notifications appear here when a crawl discovers a new matching role."
        />
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-faint">
                <th className="px-4 py-2.5 font-medium">Role</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Queued</th>
                <th className="px-4 py-2.5 font-medium">Sent</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={r.id}
                  className={cx(
                    "transition hover:bg-surface-2",
                    i > 0 && "border-t border-line/60",
                  )}
                >
                  <td className="px-4 py-2.5">
                    {r.jobUrl ? (
                      <a
                        href={r.jobUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-ink transition hover:text-accent-ink"
                      >
                        {r.title}
                      </a>
                    ) : (
                      <span className="text-ink-faint">{r.dedupKey}</span>
                    )}
                    <div className="text-xs text-ink-faint">{r.companyName}</div>
                    {r.error && <div className="mt-0.5 text-xs text-danger">{r.error}</div>}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge tone={STATUS_TONE[r.status] ?? "neutral"}>{r.status}</Badge>
                    {r.attempts > 1 && (
                      <span className="tnum ml-1.5 text-[11px] text-ink-faint">
                        {r.attempts}×
                      </span>
                    )}
                  </td>
                  <td className="tnum whitespace-nowrap px-4 py-2.5 text-ink-faint">
                    {when(r.createdAt)}
                  </td>
                  <td className="tnum whitespace-nowrap px-4 py-2.5 text-ink-faint">
                    {when(r.sentAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
