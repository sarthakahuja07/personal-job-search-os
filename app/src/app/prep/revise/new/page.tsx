import Link from "next/link";

import { PageHeader } from "@/components/ui";
import { getDb } from "@/db";
import { customDeckForm } from "@/server/service/revision";

import { CreateCustomDeckForm } from "./create-custom-deck-form";

export const dynamic = "force-dynamic";

/**
 * Build a deck by filter (company/discipline/difficulty, each optional -- it stays live, and a
 * later question that matches shows up on its own) or by hand-picking specific questions from
 * the filtered list (frozen to exactly those, even as more questions come to match the filters).
 */
export default async function NewCustomDeckPage() {
  const db = getDb();
  const { candidates, companies } = await customDeckForm(db);

  return (
    <div>
      <PageHeader
        title="New deck"
        subtitle="Filter by company, discipline and difficulty -- each optional. Leave every filter as
          'Any' and check nothing to build the Everything deck's twin with a name of your own, or
          narrow it down and pick specific questions to freeze the deck to exactly those."
      />
      <Link
        href="/prep/revise"
        className="mb-4 inline-block text-[13px] text-ink-dim transition hover:text-ink"
      >
        ← Decks
      </Link>
      <CreateCustomDeckForm candidates={candidates} companies={companies} />
    </div>
  );
}
