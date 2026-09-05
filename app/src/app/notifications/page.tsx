import { getDb } from "@/db";
import { listRecent } from "@/server/repository/notifications-repo";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  sent: "bg-emerald-100 text-emerald-800",
  pending: "bg-amber-100 text-amber-800",
  failed: "bg-red-100 text-red-800",
};

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

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight">Notifications</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Every notification ever queued. {pending} pending delivery.
      </p>
      <p className="mt-1 text-xs text-neutral-400">
        Queued at ingest, sent by the scheduled job. The unique dedup key makes a duplicate
        impossible at the database level, so a job can only ever be announced once.
      </p>

      {rows.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-neutral-300 bg-white p-8 text-center">
          <p className="font-medium text-neutral-700">Nothing queued yet.</p>
          <p className="mt-1 text-sm text-neutral-500">
            Notifications appear when a crawl finds a new relevant role.
          </p>
        </div>
      ) : (
        <div className="mt-5 overflow-x-auto rounded-lg border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-4 py-2 font-medium">Job</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Queued</th>
                <th className="px-4 py-2 font-medium">Sent</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2">
                    {r.jobUrl ? (
                      <a
                        href={r.jobUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium hover:underline"
                      >
                        {r.title}
                      </a>
                    ) : (
                      <span className="text-neutral-500">{r.dedupKey}</span>
                    )}
                    <div className="text-xs text-neutral-500">{r.companyName}</div>
                    {r.error && <div className="mt-0.5 text-xs text-red-600">{r.error}</div>}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${STATUS_STYLE[r.status] ?? ""}`}
                    >
                      {r.status}
                    </span>
                    {r.attempts > 1 && (
                      <span className="ml-1 text-[11px] text-neutral-400">
                        {r.attempts} tries
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-neutral-500">
                    {when(r.createdAt)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-neutral-500">
                    {when(r.sentAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
