import Link from "next/link";

import { Badge, Card, EmptyState, PageHeader, SectionTitle, cx } from "@/components/ui";
import { getDb } from "@/db";
import type { PrepReview } from "@/db/schema";
import type { Deck } from "@/server/domain/revision";
import { deckStats, loadDecks, reviewMap, type DeckStats } from "@/server/service/revision";

export const dynamic = "force-dynamic";

function StatLine({ stats }: { stats: DeckStats }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <Badge tone="accent">{stats.fresh} new</Badge>
      <Badge tone={stats.due > 0 ? "warn" : "neutral"}>{stats.due} due</Badge>
      <Badge tone="fresh">{stats.learned} seen</Badge>
    </div>
  );
}

function DeckCard({ deck, stats }: { deck: Deck; stats: DeckStats }) {
  const href = `/prep/revise/${deck.id.join("/")}`;
  const empty = stats.total === 0;
  return (
    <Card className={cx("flex h-full flex-col px-4 py-4", empty && "opacity-60")}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-[15px] font-medium text-ink">{deck.title}</h3>
        <span className="tnum text-[13px] text-ink-faint">{stats.total} card{stats.total === 1 ? "" : "s"}</span>
      </div>
      <div className="mt-2.5">
        <StatLine stats={stats} />
      </div>
      <div className="mt-auto flex flex-wrap gap-2 pt-4">
        {empty ? (
          <span className="text-xs text-ink-faint">No questions in this deck yet.</span>
        ) : (
          <>
            <Link
              href={href}
              className="rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-canvas transition hover:brightness-110"
            >
              Revise all
            </Link>
            {stats.due + stats.fresh > 0 && stats.due + stats.fresh < stats.total && (
              <Link
                href={`${href}?mode=due`}
                className="rounded-md border border-line bg-surface-2 px-3 py-1.5 text-[13px] text-ink-dim transition hover:border-line-strong hover:text-ink"
              >
                Due + new ({stats.due + stats.fresh})
              </Link>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

/**
 * Deck picker: every discipline, and every company that has published a question list.
 */
export default async function RevisePage() {
  const db = getDb();
  const decks = await loadDecks(db);

  // Review state is read defensively: until migration 0021 is applied the table does not exist,
  // and the decks are still worth showing -- they just all read as new.
  let reviews = new Map<string, PrepReview>();
  let migrationMissing = false;
  try {
    reviews = await reviewMap(db);
  } catch {
    migrationMissing = true;
  }

  const now = new Date();
  const disciplineDecks = decks.filter((d) => d.group === "Discipline");
  const companyDecks = decks.filter((d) => d.group === "Company");
  const companies = [...new Set(companyDecks.map((d) => d.company!))];

  return (
    <div>
      <PageHeader
        title="Revision"
        subtitle="Pick a deck. Cards come one at a time in random order: recall the answer, reveal it, and rate how well you knew it."
      />

      {migrationMissing && (
        <Card className="mb-6 border-warn px-4 py-3">
          <p className="text-[13px] text-warn">
            Review history is unavailable: the <code>prep_reviews</code> table does not exist yet.
            Apply migrations with{" "}
            <code>npx wrangler d1 migrations apply job-search-os --remote</code>. Ratings will not
            be saved until then.
          </p>
        </Card>
      )}

      <SectionTitle>By discipline</SectionTitle>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {disciplineDecks.map((deck) => (
          <DeckCard key={deck.id.join("/")} deck={deck} stats={deckStats(deck, reviews, now)} />
        ))}
      </div>

      <section className="mt-8">
        <SectionTitle>By company</SectionTitle>
        {companies.length === 0 ? (
          <EmptyState
            title="No company question lists yet"
            body="A company's DSA, HLD and LLD pages become decks here once questions are published to them."
          />
        ) : (
          <div className="space-y-6">
            {companies.map((company) => {
              const own = companyDecks.filter((d) => d.company === company);
              const unresolved = own.find((d) => d.id.length === 2)?.unresolved ?? [];
              return (
                <div key={company}>
                  <h3 className="mb-2 text-[14px] font-medium text-ink">{company}</h3>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {own.map((deck) => (
                      <DeckCard
                        key={deck.id.join("/")}
                        deck={{ ...deck, title: deck.title.replace(`${company} · `, "") }}
                        stats={deckStats(deck, reviews, now)}
                      />
                    ))}
                  </div>
                  {unresolved.length > 0 && (
                    <p className="mt-2 text-[11.5px] text-ink-faint">
                      Not in any deck (no question page yet): {unresolved.join(", ")}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
