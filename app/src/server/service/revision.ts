/**
 * Revision orchestration: build the decks from the tree, and record a rating.
 */

import type { Db } from "@/db";
import type { CustomDeckMode, PrepDifficulty, PrepReview, ReviewRating } from "@/db/schema";
import { DISCIPLINES, type Discipline } from "@/server/domain/company";
import { buildPaths } from "@/server/domain/prep";
import {
  buildCustomDeck,
  buildDecks,
  customDeckCandidates,
  intervalsFor,
  questionCards,
  schedule,
  shuffle,
  type Card,
  type CompanyIndex,
  type CustomDeckCandidate,
  type Deck,
} from "@/server/domain/revision";
import { allPagePaths, codeFilesFor, getById } from "@/server/repository/prep-repo";
import {
  allReviews,
  companyIndexPages,
  createCustomDeck,
  deleteCustomDeck,
  deleteDeckReviews,
  listCustomDecks,
  reviewFor,
  reviewsForDeck,
  saveReview,
} from "@/server/repository/revision-repo";

const deckKey = (id: string[]) => id.join("/");

/** The tree flattened into question cards and company index rows -- the shared base every deck,
 *  built-in or custom, is computed from. Two queries whatever the deck count. */
async function loadCardsAndCompanies(
  db: Db,
): Promise<{ cards: Record<Discipline, Card[]>; companies: CompanyIndex[] }> {
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

  return { cards, companies };
}

/** Every deck: built-in (Everything, each discipline, each company) plus every saved custom
 *  deck. One extra query beyond the built-in set, whatever the custom deck count. */
export async function loadDecks(db: Db): Promise<Deck[]> {
  const { cards, companies } = await loadCardsAndCompanies(db);
  const builtIn = buildDecks(cards, companies);
  const defs = await listCustomDecks(db);
  if (defs.length === 0) return builtIn;

  const candidates = customDeckCandidates(cards, companies);
  const custom = defs.map((row) =>
    buildCustomDeck(builtIn, candidates, {
      id: row.id,
      title: row.title,
      mode: row.mode,
      companySlug: row.companySlug,
      discipline: row.discipline as Discipline | null,
      difficulty: row.difficulty,
      questionIds: row.questionIds,
    }),
  );
  return [...builtIn, ...custom];
}

/** The candidate pool for the "new custom deck" form: every question, tagged with the companies
 *  that list it, plus the distinct companies worth offering as a filter. */
export async function customDeckForm(
  db: Db,
): Promise<{ candidates: CustomDeckCandidate[]; companies: { slug: string; name: string }[] }> {
  const { cards, companies } = await loadCardsAndCompanies(db);
  const bySlug = new Map(companies.map((c) => [c.slug, c.company]));
  return {
    candidates: customDeckCandidates(cards, companies),
    companies: [...bySlug.entries()]
      .map(([slug, name]) => ({ slug, name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export async function addCustomDeck(
  db: Db,
  input: {
    title: string;
    mode: CustomDeckMode;
    companySlug: string | null;
    discipline: Discipline | null;
    difficulty: PrepDifficulty | null;
    questionIds: string[] | null;
  },
): Promise<void> {
  await createCustomDeck(db, input);
}

/** Deletes a custom deck and its progress. Nothing else references a custom deck's id, so this
 *  is the only cleanup a delete needs. */
export async function removeCustomDeck(db: Db, id: string): Promise<void> {
  await deleteDeckReviews(db, deckKey(["custom", id]));
  await deleteCustomDeck(db, id);
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

/**
 * Every deck's review state, grouped by deck.
 *
 * Decks overlap by design -- Everything is the union of every other deck -- and progress is
 * tracked per (deck, card), not per card, so each deck needs its own map: a card "seen" in DSA
 * is still "new" in Everything until Everything is revised on its own.
 */
export async function reviewMapsByDeck(db: Db): Promise<Map<string, Map<string, PrepReview>>> {
  const rows = await allReviews(db);
  const byDeck = new Map<string, Map<string, PrepReview>>();
  for (const row of rows) {
    let deck = byDeck.get(row.deckId);
    if (!deck) {
      deck = new Map();
      byDeck.set(row.deckId, deck);
    }
    deck.set(row.prepItemId, row);
  }
  return byDeck;
}

/** Everything a card needs to render both of its sides. Plain data: it crosses to the client. */
export async function cardDetail(db: Db, deckId: string[], id: string) {
  const [item, codeFiles, review] = await Promise.all([
    getById(db, id),
    codeFilesFor(db, id),
    reviewFor(db, deckKey(deckId), id),
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

export async function rateCard(
  db: Db,
  deckId: string[],
  id: string,
  rating: ReviewRating,
  now = new Date(),
) {
  const key = deckKey(deckId);
  const previous = await reviewFor(db, key, id);
  const next = schedule(previous, rating, now);
  await saveReview(db, {
    deckId: key,
    prepItemId: id,
    ...next,
    lastRating: rating,
    lastReviewedAt: now,
  });
  return next;
}

/** Forget every card in a deck: deletes its review state so every card in it goes back to "new".
 *  Scoped to this deck's own rows -- a card that also appears in Everything or a company deck
 *  keeps its standing there untouched, since each deck's progress is independent. */
export async function resetDeckProgress(db: Db, deck: Deck): Promise<void> {
  await deleteDeckReviews(db, deckKey(deck.id));
}

/**
 * The cards for one session, shuffled: the whole deck, or only what is due plus what is new.
 *
 * Review state is optional here: until the `prep_reviews` migration is applied there is no
 * table, nothing has been reviewed, and every card counts as new.
 */
export async function sessionCards(db: Db, deck: Deck, mode: "all" | "due", now = new Date()) {
  if (mode === "all") return shuffle(deck.cards);
  let reviews = new Map<string, PrepReview>();
  try {
    const rows = await reviewsForDeck(db, deckKey(deck.id));
    reviews = new Map(rows.map((r) => [r.prepItemId, r]));
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
