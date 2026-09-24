/**
 * Revision orchestration: build the decks from the tree, and record a rating.
 */

import type { Db } from "@/db";
import type { PrepReview, ReviewRating } from "@/db/schema";
import { DISCIPLINES, type Discipline } from "@/server/domain/company";
import { buildPaths } from "@/server/domain/prep";
import {
  buildDecks,
  intervalsFor,
  questionCards,
  schedule,
  shuffle,
  type CompanyIndex,
  type Deck,
} from "@/server/domain/revision";
import { allPagePaths, codeFilesFor, getById } from "@/server/repository/prep-repo";
import {
  allReviews,
  companyIndexPages,
  reviewFor,
  saveReview,
} from "@/server/repository/revision-repo";

/** Three queries whatever the deck count: the tree, the company lists, nothing per company. */
export async function loadDecks(db: Db): Promise<Deck[]> {
  const [rows, indexPages] = await Promise.all([allPagePaths(db), companyIndexPages(db)]);
  const cards = questionCards(rows, buildPaths(rows));

  const byId = new Map(rows.map((r) => [r.id, r]));
  const companies: CompanyIndex[] = [];
  for (const page of indexPages) {
    const folder = page.parentId ? byId.get(page.parentId) : undefined;
    // Only a company's own top-level pages. A "dsa" page nested deeper is someone's note.
    if (!folder || folder.kind !== "company" || folder.parentId !== null) continue;
    const stored = page.content?.rows;
    if (!Array.isArray(stored)) continue;
    const titles = stored
      .map((r) => (r && typeof r === "object" ? (r as { title?: unknown }).title : null))
      .filter((t): t is string => typeof t === "string" && t.trim().length > 0);
    if (titles.length === 0) continue;
    if (!(DISCIPLINES as readonly string[]).includes(page.slug)) continue;
    companies.push({
      company: folder.title,
      slug: folder.slug,
      discipline: page.slug as Discipline,
      titles,
    });
  }

  return buildDecks(cards, companies);
}

export type DeckStats = { total: number; fresh: number; due: number; learned: number };

export function deckStats(deck: Deck, reviews: Map<string, PrepReview>, now: Date): DeckStats {
  let fresh = 0;
  let due = 0;
  for (const card of deck.cards) {
    const r = reviews.get(card.id);
    if (!r) fresh++;
    else if (r.dueAt.getTime() <= now.getTime()) due++;
  }
  return { total: deck.cards.length, fresh, due, learned: deck.cards.length - fresh };
}

export async function reviewMap(db: Db): Promise<Map<string, PrepReview>> {
  const rows = await allReviews(db);
  return new Map(rows.map((r) => [r.prepItemId, r]));
}

/** Everything a card needs to render both of its sides. Plain data: it crosses to the client. */
export async function cardDetail(db: Db, id: string) {
  const [item, codeFiles, review] = await Promise.all([
    getById(db, id),
    codeFilesFor(db, id),
    reviewFor(db, id),
  ]);
  if (!item) return null;
  return {
    id: item.id,
    kind: item.kind,
    title: item.title,
    prompt: item.prompt,
    difficulty: item.difficulty,
    companies: item.companies,
    topics: item.topics,
    body: item.body,
    notes: item.notes,
    solution: item.solution,
    sourceUrl: item.sourceUrl,
    content: item.content ?? {},
    codeFiles: codeFiles.map((f) => ({
      id: f.id,
      path: f.path,
      language: f.language,
      content: f.content,
    })),
    intervals: intervalsFor(review),
  };
}

export type CardDetail = NonNullable<Awaited<ReturnType<typeof cardDetail>>>;

export async function rateCard(db: Db, id: string, rating: ReviewRating, now = new Date()) {
  const previous = await reviewFor(db, id);
  const next = schedule(previous, rating, now);
  await saveReview(db, {
    prepItemId: id,
    ...next,
    lastRating: rating,
    lastReviewedAt: now,
  });
  return next;
}

/**
 * The cards for one session, shuffled: the whole deck, or only what is due plus what is new.
 *
 * Review state is optional here: until migration 0021 is applied there is no table, nothing has
 * been reviewed, and every card counts as new.
 */
export async function sessionCards(db: Db, deck: Deck, mode: "all" | "due", now = new Date()) {
  if (mode === "all") return shuffle(deck.cards);
  let reviews = new Map<string, PrepReview>();
  try {
    reviews = await reviewMap(db);
  } catch {
    // See above: an unmigrated database means everything is new.
  }
  return shuffle(
    deck.cards.filter((c) => {
      const r = reviews.get(c.id);
      return !r || r.dueAt.getTime() <= now.getTime();
    }),
  );
}
