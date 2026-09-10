import Link from "next/link";

import { Badge, Card, EmptyState, PageHeader, SectionTitle } from "@/components/ui";
import { getDb } from "@/db";
import { settings } from "@/db/schema";
import { followUpsDue } from "@/server/domain/applications";
import { whatsappLink } from "@/server/domain/templates";
import { listBoard, requestedWithContacts } from "@/server/repository/applications-repo";
import { listCompanyHealth } from "@/server/repository/jobs-repo";
import { AddByLink } from "./add-by-link";
import { Board } from "./board";

export const dynamic = "force-dynamic";

export default async function ApplicationsPage() {
  const db = getDb();
  const [cards, requested, settingsRows, allCompanies] = await Promise.all([
    listBoard(db),
    requestedWithContacts(db),
    db.select({ followUpDays: settings.followUpDays }).from(settings).limit(1),
    listCompanyHealth(db),
  ]);

  const thresholdDays = settingsRows[0]?.followUpDays ?? 5;
  const due = followUpsDue(
    requested.map((r) => ({
      id: r.id,
      status: r.status,
      requestedAt: r.requestedAt,
      jobTitle: r.jobTitle,
      companyName: r.companyName,
    })),
    thresholdDays,
  );
  const contactsById = new Map(requested.map((r) => [r.id, r.contacts]));

  return (
    <div>
      <PageHeader
        title="Applications"
        subtitle={
          cards.length > 0 ? (
            <>
              <span className="tnum text-ink">{cards.length}</span> role
              {cards.length === 1 ? "" : "s"} in the pipeline. Drag a card, or use its menu.
            </>
          ) : (
            "Track a role from saved through to interviews."
          )
        }
      />

      {due.length > 0 && (
        <section className="mb-6">
          <SectionTitle>
            Follow up · waiting {thresholdDays}+ days
          </SectionTitle>
          <ul className="space-y-1.5">
            {due.map((f) => {
              const contacts = contactsById.get(f.id) ?? [];
              const message =
                `Hi, just following up on the ${f.jobTitle} role at ${f.companyName} ` +
                `I mentioned — no rush at all, and thanks again for the help!`;
              return (
                <Card as="li" key={f.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-body text-ink">
                        <span className="font-medium">{f.companyName}</span>
                        <span className="text-ink-dim"> — {f.jobTitle}</span>
                      </p>
                      <p className="mt-0.5 text-meta text-ink-faint">
                        Referral requested{" "}
                        <span className="tnum text-warn">{f.daysWaiting} days</span> ago
                        {contacts.length > 0 && (
                          <> · ask {contacts.map((c) => c.name).join(" or ")}</>
                        )}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-1.5">
                      {/* Every contact, not the first three: a capped list silently removes
                          the person you actually wanted to ask. */}
                      {contacts.map((c) => {
                        const wa = whatsappLink(c.phone, message);
                        return wa ? (
                          <a
                            key={c.name}
                            href={wa}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="rounded-control border border-line bg-surface-2 px-2.5 py-1 text-meta text-ink-dim transition hover:border-line-strong hover:text-ink"
                          >
                            Nudge {c.name}
                          </a>
                        ) : null;
                      })}
                    </div>
                  </div>
                </Card>
              );
            })}
          </ul>
        </section>
      )}

      <AddByLink
        companies={allCompanies
          .filter((c) => c.active)
          .map((c) => ({ id: c.id, name: c.name }))}
      />

      {cards.length === 0 ? (
        <EmptyState
          title="No applications yet"
          body="Save a role from the job board and it appears here. The board has exactly five stages — enough to know what needs a nudge, few enough that it never becomes admin."
          hint={
            <Link href="/jobs" className="text-ink hover:underline">
              Browse matching roles →
            </Link>
          }
        />
      ) : (
        <Board cards={cards} />
      )}

      {cards.length > 0 && (
        <p className="mt-6 text-label leading-relaxed text-ink-faint">
          Stage timestamps are recorded the first time a card reaches a stage and are never
          cleared, so moving a card back to correct a mis-drag does not erase when you actually
          asked for the referral. <Badge>Requested</Badge> is the only stage that raises a
          follow-up — once a referral is in, the ball is not in your court.
        </p>
      )}
    </div>
  );
}
