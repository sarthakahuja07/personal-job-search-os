/**
 * Revision: Anki-style flashcards over the prep tree.
 *
 * Two things live here, both pure so they are testable without a database:
 *
 *   decks       which prep pages count as a question, grouped by discipline and by company.
 *               A deck is derived from the tree on every visit rather than stored, so a newly
 *               published question is in its deck the moment it exists.
 *   scheduling  a simplified SM-2, the algorithm Anki grew out of: a per-card ease factor that
 *               "hard" and "again" wear down and "easy" builds up, multiplied into the interval.
 */

import type { PrepDifficulty, PrepKind, ReviewRating } from "@/db/schema";
import { isQuestion } from "./prep-questions";
import { DISCIPLINES, DISCIPLINE_TITLE, type Discipline } from "./company";

// ---------------------------------------------------------------------------
// Decks
// ---------------------------------------------------------------------------

export type TreeRow = {
  id: string;
  kind: PrepKind;
  slug: string;
  title: string;
  parentId: string | null;
  difficulty?: PrepDifficulty | null;
  isReader?: boolean;
};

export type Card = {
  id: string;
  title: string;
  discipline: Discipline;
  difficulty: PrepDifficulty | null;
  /** Page path under /prep, e.g. "dsa/arrays/two-sum". */
  href: string;
};

export type Deck = {
  /** URL segments under /prep/revise, e.g. ["dsa"] or ["company", "confluent", "dsa"]. */
  id: string[];
  title: string;
  group: "Discipline" | "Company" | "Custom";
  company?: string;
  cards: Card[];
  /** Company only: questions on the company's list with no page to revise from yet. */
  unresolved?: string[];
};

const SEGMENT: Record<PrepKind, string> = {
  dsa: "dsa",
  system_design: "system-design",
  behavioral: "behavioral",
  concept: "concept",
  company: "company",
};

/**
 * Every question card, by discipline.
 *
 * "Is this a question" is `isQuestion` from `prep-questions.ts` -- the same rule the prep
 * sidebar and search use, so a flashcard deck and the sidebar's question count never disagree.
 * DSA nests directly under its pattern folders; HLD keeps questions under `hld/questions`; LLD's
 * questions sit beside its `resources` folder rather than under a `lld/questions` folder of
 * their own.
 */
export function questionCards(
  rows: TreeRow[],
  paths: Map<string, string>,
): Record<Discipline, Card[]> {
  const parents = new Set(rows.map((r) => r.parentId).filter(Boolean));
  const out: Record<Discipline, Card[]> = { dsa: [], hld: [], lld: [] };

  for (const row of rows) {
    const path = paths.get(row.id) ?? row.slug;
    const question = { ...row, difficulty: row.difficulty ?? null, isReader: row.isReader ?? false };
    if (!isQuestion(question, path, parents.has(row.id))) continue;

    let discipline: Discipline | undefined;
    if (row.kind === "dsa") discipline = "dsa";
    else if (row.kind === "system_design") {
      if (path.startsWith("hld/")) discipline = "hld";
      else if (path.startsWith("lld/")) discipline = "lld";
    }
    if (!discipline) continue;

    out[discipline].push({
      id: row.id,
      title: row.title,
      discipline,
      difficulty: row.difficulty ?? null,
      href: `${SEGMENT[row.kind]}/${path}`,
    });
  }
  for (const d of DISCIPLINES) out[d].sort((a, b) => a.title.localeCompare(b.title));
  return out;
}

const identity = (title: string) =>
  title
    .toLowerCase()
    .replace(/^(design|implement)\s+(an?\s+)?/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * The card a company's listed question refers to.
 *
 * Exact title first, then containment either way -- the list says "Design a Rate Limiter" where
 * the page is "Rate Limiter". The same leniency the company index uses to link questions, so a
 * question that shows as linked on the company page is the one that lands in its deck.
 */
export function matchCard(cards: Card[], title: string): Card | undefined {
  const wanted = identity(title);
  if (!wanted) return undefined;
  return (
    cards.find((c) => identity(c.title) === wanted) ??
    cards.find((c) => {
      const have = identity(c.title);
      return have.length > 0 && (have.includes(wanted) || wanted.includes(have));
    })
  );
}

export type CompanyIndex = {
  company: string;
  slug: string;
  discipline: Discipline;
  titles: string[];
};

/**
 * The full deck list: one per discipline, a mixed "everything" deck, and per company one per
 * discipline plus a company-wide deck. Empty company decks are dropped -- a company with no LLD
 * list has nothing to pick.
 */
export function buildDecks(
  cards: Record<Discipline, Card[]>,
  companies: CompanyIndex[],
): Deck[] {
  const decks: Deck[] = [];
  const all = DISCIPLINES.flatMap((d) => cards[d]);
  decks.push({ id: ["all"], title: "Everything", group: "Discipline", cards: all });
  for (const d of DISCIPLINES) {
    decks.push({ id: [d], title: DISCIPLINE_TITLE[d], group: "Discipline", cards: cards[d] });
  }

  const byCompany = new Map<string, CompanyIndex[]>();
  for (const index of companies) {
    byCompany.set(index.slug, [...(byCompany.get(index.slug) ?? []), index]);
  }

  for (const [slug, indexes] of [...byCompany.entries()].sort()) {
    const company = indexes[0].company;
    const perDiscipline: Deck[] = [];
    for (const d of DISCIPLINES) {
      const titles = indexes.filter((i) => i.discipline === d).flatMap((i) => i.titles);
      if (titles.length === 0) continue;
      const seen = new Set<string>();
      const deckCards: Card[] = [];
      const unresolved: string[] = [];
      for (const title of titles) {
        const card = matchCard(cards[d], title);
        if (!card) unresolved.push(title);
        else if (!seen.has(card.id)) {
          seen.add(card.id);
          deckCards.push(card);
        }
      }
      perDiscipline.push({
        id: ["company", slug, d],
        title: `${company} · ${DISCIPLINE_TITLE[d]}`,
        group: "Company",
        company,
        cards: deckCards,
        unresolved,
      });
    }
    if (perDiscipline.length === 0) continue;
    decks.push({
      id: ["company", slug],
      title: `${company} · All`,
      group: "Company",
      company,
      cards: perDiscipline.flatMap((d) => d.cards),
      unresolved: perDiscipline.flatMap((d) => d.unresolved ?? []),
    });
    decks.push(...perDiscipline);
  }
  return decks;
}

export function findDeck(decks: Deck[], id: string[]): Deck | undefined {
  const key = id.join("/");
  return decks.find((d) => d.id.join("/") === key);
}

// ---------------------------------------------------------------------------
// Custom decks
// ---------------------------------------------------------------------------

/** Every question, flattened across disciplines, tagged with the companies whose published list
 *  includes it -- what a custom deck's filter form filters over. */
export type CustomDeckCandidate = Card & { companySlugs: string[] };

/**
 * The full candidate pool for building a custom deck: every question, each carrying which
 * companies list it.
 *
 * Company membership is computed the same way a company deck's cards are (`matchCard` against
 * its titles) rather than duplicated data, so a question that resolves on a company's page is
 * exactly the one this offers as belonging to that company.
 */
export function customDeckCandidates(
  cards: Record<Discipline, Card[]>,
  companies: CompanyIndex[],
): CustomDeckCandidate[] {
  const companySlugsByCard = new Map<string, Set<string>>();
  for (const index of companies) {
    for (const title of index.titles) {
      const card = matchCard(cards[index.discipline], title);
      if (!card) continue;
      const slugs = companySlugsByCard.get(card.id) ?? new Set<string>();
      slugs.add(index.slug);
      companySlugsByCard.set(card.id, slugs);
    }
  }
  return DISCIPLINES.flatMap((d) => cards[d]).map((card) => ({
    ...card,
    companySlugs: [...(companySlugsByCard.get(card.id) ?? [])],
  }));
}

export type CustomDeckDef = {
  id: string;
  title: string;
  mode: "filter" | "fixed";
  companySlug: string | null;
  discipline: Discipline | null;
  difficulty: PrepDifficulty | null;
  /** Only meaningful when `mode` is "fixed". */
  questionIds: string[] | null;
};

/**
 * A user-defined deck: either a live filter over `builtIn`'s decks, or a frozen list of specific
 * questions.
 *
 * Filter mode is deliberately built by looking up the matching built-in deck (the company+
 * discipline combination, or "all") and filtering by difficulty on top, rather than
 * re-implementing company/discipline matching here -- a filtered custom deck can never disagree
 * with the built-in deck it's a slice of. Fixed mode resolves each stored id against the full
 * candidate pool and silently drops any that no longer exist (a question can be unpublished after
 * being frozen into a deck).
 */
export function buildCustomDeck(
  builtIn: Deck[],
  candidates: CustomDeckCandidate[],
  def: CustomDeckDef,
): Deck {
  let cards: Card[];
  if (def.mode === "fixed") {
    const byId = new Map(candidates.map((c) => [c.id, c]));
    cards = (def.questionIds ?? [])
      .map((id) => byId.get(id))
      .filter((c): c is CustomDeckCandidate => Boolean(c));
  } else {
    const baseId = def.companySlug
      ? def.discipline
        ? ["company", def.companySlug, def.discipline]
        : ["company", def.companySlug]
      : def.discipline
        ? [def.discipline]
        : ["all"];
    const base = findDeck(builtIn, baseId)?.cards ?? [];
    cards = def.difficulty ? base.filter((c) => c.difficulty === def.difficulty) : base;
  }
  return { id: ["custom", def.id], title: def.title, group: "Custom", cards };
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

export type ReviewState = {
  ease: number;
  intervalDays: number;
  reps: number;
  lapses: number;
};

export const NEW_CARD: ReviewState = { ease: 2.5, intervalDays: 0, reps: 0, lapses: 0 };

const MIN_EASE = 1.3;
const MAX_INTERVAL = 3650;
const DAY_MS = 86_400_000;
/** "Again" brings a card back in ten minutes -- in practice, later in the same session. */
export const RELEARN_MS = 10 * 60_000;

/** Days until the card is due again after each rating. 0 means "later today". */
export function intervalsFor(state: ReviewState | null): Record<ReviewRating, number> {
  const s = state ?? NEW_CARD;
  const base = s.intervalDays;
  if (base <= 0) {
    // A new or just-forgotten card: short, fixed first steps, as Anki's learning steps are.
    return { again: 0, hard: 1, good: 2, easy: 4 };
  }
  const cap = (n: number) => Math.min(MAX_INTERVAL, n);
  const hard = cap(Math.max(base + 1, Math.round(base * 1.2)));
  const good = cap(Math.max(hard + 1, Math.round(base * s.ease)));
  const easy = cap(Math.max(good + 1, Math.round(base * s.ease * 1.3)));
  return { again: 0, hard, good, easy };
}

const EASE_DELTA: Record<ReviewRating, number> = {
  again: -0.2,
  hard: -0.15,
  good: 0,
  easy: 0.15,
};

export function schedule(
  state: ReviewState | null,
  rating: ReviewRating,
  now: Date,
): ReviewState & { dueAt: Date } {
  const s = state ?? NEW_CARD;
  const intervalDays = intervalsFor(s)[rating];
  return {
    ease: Math.max(MIN_EASE, Math.round((s.ease + EASE_DELTA[rating]) * 100) / 100),
    intervalDays,
    reps: s.reps + 1,
    // Forgetting a card you had learned is a lapse; failing a brand-new one is not.
    lapses: s.lapses + (rating === "again" && s.reps > 0 ? 1 : 0),
    dueAt: new Date(now.getTime() + (intervalDays === 0 ? RELEARN_MS : intervalDays * DAY_MS)),
  };
}

/** The label above a rating button: "<10m", "3d", "2w", "4mo", "1.5y". */
export function formatInterval(days: number): string {
  if (days <= 0) return "<10m";
  if (days < 14) return `${days}d`;
  if (days < 60) return `${Math.round(days / 7)}w`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  const years = Math.round((days / 365) * 10) / 10;
  return `${years}y`;
}

/** Fisher-Yates. The random source is injectable so the order is testable. */
export function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
