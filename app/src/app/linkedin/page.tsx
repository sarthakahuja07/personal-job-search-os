import { Collapsible } from "@/components/collapsible";
import { JobCard, type JobRow } from "@/components/job-card";
import { LeadGroup, type Lead } from "@/components/lead-group";
import { EmptyState, PageHeader, SectionTitle } from "@/components/ui";
import { getDb } from "@/db";
import type { FitBand, FitSignal } from "@/server/domain/fit";
import * as repo from "@/server/repository/linkedin-repo";

export const dynamic = "force-dynamic";

/**
 * LinkedIn.
 *
 * Three questions, kept apart because they are genuinely different: what Sarthak's own saved
 * searches turned up, what LinkedIn thinks matches his profile, and which employers keep
 * appearing that are not on the board at all.
 *
 * The job cards are the shared component, not a copy. Two earlier drifts between Jobs and the
 * Dashboard were fixed by hand; a third version of the same card would drift again.
 */
export default async function LinkedInPage() {
  const db = getDb();
  const [rows, leadRows, counts, contactCounts, mergedCount] = await Promise.all([
    repo.listLinkedInJobs(db),
    repo.listLeads(db),
    repo.linkedinCounts(db),
    repo.contactCounts(db),
    repo.linkedinMergedCount(db),
  ]);

  const toCard = (r: (typeof rows)[number]): JobRow => ({
    id: r.id,
    title: r.title,
    location: r.location,
    jobUrl: r.jobUrl,
    postedAt: r.postedAt,
    discoveredAt: r.discoveredAt,
    matchScore: r.matchScore,
    matchReason: r.matchReason,
    locationPriority: r.locationPriority,
    fitScore: r.fitScore,
    fitBand: r.fitBand as FitBand | null,
    fitSignals: r.fitSignals as FitSignal[] | null,
    fitTitleOnly: r.fitTitleOnly ?? undefined,
    readAt: r.readAt,
    companyName: r.companyName,
    companyId: r.companyId,
    applicationStatus: r.applicationStatus,
  });

  const feedOf = (r: (typeof rows)[number]) =>
    (r.rawMetadata as { feed?: string } | null)?.feed ?? "search";

  // Only postings LinkedIn itself surfaced. A job found through a company's ATS that LinkedIn
  // also lists belongs on Jobs, not here -- it is counted in the header instead of duplicated.
  const fromLinkedIn = rows.filter((r) => r.source === "linkedin_email" && r.isRelevant);
  const untouched = fromLinkedIn.filter((r) => !r.readAt && !r.applicationStatus);

  const search = untouched.filter((r) => feedOf(r) !== "recommended");
  const recommended = untouched.filter((r) => feedOf(r) === "recommended");
  const handled = fromLinkedIn.filter((r) => r.readAt || r.applicationStatus);

  const outreachFor = (companyId: string) => ({
    contactCount: contactCounts.get(companyId) ?? 0,
  });

  const byCompany = new Map<string, Lead[]>();
  for (const l of leadRows) {
    byCompany.set(l.companyName, [...(byCompany.get(l.companyName) ?? []), l as Lead]);
  }
  const leadGroups = [...byCompany.entries()].sort(
    (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
  );

  const nothing = search.length === 0 && recommended.length === 0 && leadGroups.length === 0;

  return (
    <div>
      <PageHeader
        title="LinkedIn"
        subtitle={
          <>
            <span className="tnum text-ink">{counts.unreadJobs}</span> to review
            <span className="text-ink-faint">
              {" · "}
              {counts.leads} at companies you don&apos;t have
              {mergedCount > 0 && <> · {mergedCount} already on your board</>}
            </span>
          </>
        }
      />

      {nothing ? (
        <EmptyState
          title="Nothing from LinkedIn yet"
          body={
            "Alert mail is read every twelve hours alongside the company crawl. If this stays " +
            "empty, check that the job alerts are still active on LinkedIn and that IMAP " +
            "access is switched on for the mailbox."
          }
        />
      ) : (
        <div className="space-y-6">
          {search.length > 0 && (
            <section>
              <SectionTitle>From your searches · {search.length}</SectionTitle>
              <div className="space-y-2">
                {search.map((r) => (
                  <JobCard key={r.id} job={toCard(r)} outreach={outreachFor(r.companyId)} />
                ))}
              </div>
            </section>
          )}

          {recommended.length > 0 && (
            <section>
              <SectionTitle>Picked for you by LinkedIn · {recommended.length}</SectionTitle>
              <div className="space-y-2">
                {recommended.map((r) => (
                  <JobCard key={r.id} job={toCard(r)} outreach={outreachFor(r.companyId)} />
                ))}
              </div>
            </section>
          )}

          {leadGroups.length > 0 && (
            <section>
              <Collapsible
                label="Companies you don't have"
                defaultOpen={search.length + recommended.length === 0}
                header={
                  <div className="text-left">
                    <SectionTitle>
                      Companies you don&apos;t have · {leadGroups.length}
                    </SectionTitle>
                    <p className="-mt-1 text-[11px] text-ink-faint">
                      {leadRows.length} opening{leadRows.length === 1 ? "" : "s"}. Adding a
                      company brings its postings onto the board.
                    </p>
                  </div>
                }
              >
                <div className="space-y-2">
                  {leadGroups.map(([companyName, leads]) => (
                    <LeadGroup key={companyName} companyName={companyName} leads={leads} />
                  ))}
                </div>
              </Collapsible>
            </section>
          )}

          {handled.length > 0 && (
            <section>
              <Collapsible
                label="Already handled"
                defaultOpen={false}
                header={<SectionTitle>Already handled · {handled.length}</SectionTitle>}
              >
                <div className="space-y-2">
                  {handled.map((r) => (
                    <JobCard key={r.id} job={toCard(r)} outreach={outreachFor(r.companyId)} />
                  ))}
                </div>
              </Collapsible>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
