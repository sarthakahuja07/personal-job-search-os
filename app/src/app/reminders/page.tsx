import { EmptyState, PageHeader, SectionTitle } from "@/components/ui";
import { ReminderList } from "@/components/reminder-list";
import { getDb } from "@/db";
import { settings } from "@/db/schema";
import {
  buildReminders,
  DEFAULT_THRESHOLDS,
  KIND_LABEL,
  type ReminderCandidate,
  type ReminderKind,
} from "@/server/domain/reminders";
import { listReminderCandidates } from "@/server/repository/jobs-repo";

export const dynamic = "force-dynamic";

export default async function RemindersPage() {
  const db = getDb();
  const [rows, settingsRows] = await Promise.all([
    listReminderCandidates(db),
    db.select({ followUpDays: settings.followUpDays }).from(settings).limit(1),
  ]);

  // The referral threshold is the one Sarthak can already tune in Settings; the rest are
  // properties of the process rather than preferences.
  const thresholds = {
    ...DEFAULT_THRESHOLDS,
    referralStatusDays: settingsRows[0]?.followUpDays ?? DEFAULT_THRESHOLDS.referralStatusDays,
  };

  const reminders = buildReminders(
    rows.map((r) => ({ ...r, hasContact: Boolean(r.hasContact) })) as ReminderCandidate[],
    thresholds,
  );

  const overdue = reminders.filter((r) => r.severity === "overdue");
  const due = reminders.filter((r) => r.severity === "due");

  const byKind = reminders.reduce<Record<string, number>>((acc, r) => {
    acc[r.kind] = (acc[r.kind] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div>
      <PageHeader
        title="Reminders"
        subtitle={
          reminders.length === 0 ? (
            "Nothing is waiting on you"
          ) : (
            <>
              <span className="tnum text-ink">{reminders.length}</span> thing
              {reminders.length === 1 ? "" : "s"} waiting on you
              {overdue.length > 0 && (
                <>
                  {" · "}
                  <span className="tnum text-warn">{overdue.length}</span> overdue
                </>
              )}
            </>
          )
        }
      />

      {reminders.length === 0 ? (
        <EmptyState
          title="Nothing to chase"
          body={
            "No referral is waiting on a reply, no referral has gone unapplied, and no strong " +
            "match is sitting untouched. This page stays empty when the pipeline is moving."
          }
        />
      ) : (
        <>
          <div className="mb-5 flex flex-wrap gap-1.5">
            {Object.entries(byKind).map(([kind, n]) => (
              <span
                key={kind}
                className="rounded border border-line bg-surface-2 px-2 py-1 text-[11px] text-ink-dim"
              >
                {KIND_LABEL[kind as ReminderKind]}
                <span className="tnum ml-1.5 text-ink-faint">{n}</span>
              </span>
            ))}
          </div>

          {overdue.length > 0 && (
            <section className="mb-6">
              <SectionTitle>Overdue · {overdue.length}</SectionTitle>
              <ReminderList reminders={overdue} />
            </section>
          )}

          {due.length > 0 && (
            <section>
              <SectionTitle>Due · {due.length}</SectionTitle>
              <ReminderList reminders={due} />
            </section>
          )}
        </>
      )}
    </div>
  );
}
