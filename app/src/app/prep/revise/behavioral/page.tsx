import Link from "next/link";

import { BehavioralRehearse, type RehearseCard } from "@/components/behavioral-rehearse";
import { PageHeader } from "@/components/ui";
import { getDb } from "@/db";
import { assembleBehavioral } from "@/server/domain/behavioral";
import { behavioralRows } from "@/server/repository/prep-repo";

export const dynamic = "force-dynamic";

/**
 * /prep/revise/behavioral -- rehearsing stories out loud.
 *
 * A static route beside `revise/[...deck]`, not one more deck: decks are spaced repetition over
 * technical questions, keyed by discipline throughout (company indexes, custom decks), and a
 * story is rehearsed against a clock rather than graded Again/Good. See BehavioralRehearse.
 */
export default async function RehearseBehavioralPage({
  searchParams,
}: {
  searchParams: Promise<{ focus?: string }>;
}) {
  const { focus } = await searchParams;
  const { projects, questions } = assembleBehavioral(await behavioralRows(getDb()));

  const cards: RehearseCard[] = [
    ...projects.map((p) => ({
      id: p.id,
      prompt: `Walk me through ${p.title}`,
      group: "projects",
      groupTitle: p.org ? `Project pitch · ${p.org}` : "Project pitch",
      url: p.url,
      shape: { kind: "prose" as const, text: p.pitch },
      targetSeconds: 90,
      story: null,
    })),
    ...questions.map((q) => ({
      id: q.id,
      prompt: q.title,
      // `questions/<theme>/<slug>`: the theme folder's slug names the group.
      group: q.path.split("/")[1] ?? "",
      groupTitle: q.theme,
      url: q.url,
      shape: q.shape,
      // An unanswered question still gets a target: two minutes is the usual ceiling.
      targetSeconds: q.seconds || 120,
      story: q.story?.title ?? null,
    })),
  ];

  const groups: { slug: string; title: string }[] = [];
  if (projects.length > 0) groups.push({ slug: "projects", title: "Project pitches" });
  for (const c of cards) {
    if (c.group !== "projects" && !groups.some((g) => g.slug === c.group)) {
      groups.push({ slug: c.group, title: c.groupTitle });
    }
  }

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Rehearse behavioral"
        subtitle="Say each answer out loud before revealing it. The clock is the one the interviewer is quietly running."
        actions={
          <>
            <Link href="/prep/behavioral" className="text-[13px] text-ink-dim transition hover:text-ink">
              Behavioral
            </Link>
            <Link href="/prep/revise" className="text-[13px] text-ink-dim transition hover:text-ink">
              ← Revise
            </Link>
          </>
        }
      />
      <BehavioralRehearse cards={cards} groups={groups} initialFocus={focus ?? "all"} />
    </div>
  );
}
