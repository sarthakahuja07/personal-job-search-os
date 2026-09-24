/**
 * The questions inside a prep folder, and searching them.
 *
 * Prep is a tree: DSA nests questions two and three folders deep under patterns and
 * sub-patterns, HLD keeps its questions under `hld/questions`, LLD beside its `resources`. A
 * discipline's landing page used to list only its top-level rows -- fourteen pattern folders for
 * DSA -- so "every question I have" was a walk through the sidebar. This flattens the tree into
 * the questions themselves, remembering which folders each sat in.
 *
 * Pure and client-safe (no database, no Node APIs): the list is built on the server, and the
 * search runs in the browser on every keystroke, over a few hundred rows.
 */

import type { PrepDifficulty, PrepKind, PrepStatus } from "@/db/schema";

export type QuestionSourceRow = {
  id: string;
  parentId: string | null;
  kind: PrepKind;
  slug: string;
  title: string;
  prompt: string | null;
  topics: string[];
  companies: string[];
  difficulty: PrepDifficulty | null;
  status: PrepStatus;
  frequency: number;
  /** A book, PDF, embedded site or GitHub folder -- something read, not answered. */
  isReader: boolean;
};

export type Question = {
  id: string;
  title: string;
  prompt: string | null;
  /** Slash path under the discipline, e.g. `1-arrays-strings/sliding-window/two-sum`. */
  path: string;
  url: string;
  /** Titles of the folders between the listing's root and the question, outermost first. */
  folders: string[];
  topics: string[];
  companies: string[];
  difficulty: PrepDifficulty | null;
  status: PrepStatus;
  frequency: number;
};

/**
 * Is this page a question, as opposed to a folder, a folder's Notes page, or reference material?
 *
 * A folder is a page with children -- unless it has been graded with a difficulty, which only a
 * question gets (one DSA question has a follow-up nested under it and is still a question).
 *
 * System design mixes questions with study material in one tree: `hld/books`, `hld/rdbms` and
 * `lld/resources` are notes *about* design, not designs to practise. Only `hld/questions` and
 * the pages beside LLD's resources are questions there.
 */
export function isQuestion(row: QuestionSourceRow, path: string, hasChildren: boolean): boolean {
  if (row.slug === "notes" || row.isReader) return false;
  if (hasChildren && !row.difficulty) return false;
  if (row.kind === "company" || row.kind === "concept") return false;
  if (row.kind === "system_design") {
    if (path.startsWith("hld/")) return path.startsWith("hld/questions/");
    if (path.startsWith("lld/")) return !path.startsWith("lld/resources/");
  }
  return true;
}

/**
 * Every question under `rootPath` (the whole discipline when empty), in sidebar order.
 *
 * `rows` must be one kind's pages, ordered by position then title -- the order siblings appear
 * in the sidebar -- so the flattened list reads in the same order as the tree it came from.
 */
export function collectQuestions(
  rows: QuestionSourceRow[],
  segment: string,
  rootPath = "",
): Question[] {
  const children = new Map<string | null, QuestionSourceRow[]>();
  for (const r of rows) {
    const list = children.get(r.parentId) ?? [];
    list.push(r);
    children.set(r.parentId, list);
  }

  const out: Question[] = [];
  const rootParts = rootPath.split("/").filter(Boolean);

  // Depth-bounded like buildPaths: a parent cycle from a bad import must not hang the request.
  const walk = (parentId: string | null, parts: string[], titles: string[], depth: number) => {
    if (depth > 20) return;
    for (const row of children.get(parentId) ?? []) {
      const nextParts = [...parts, row.slug];
      const path = nextParts.join("/");
      const kids = children.get(row.id) ?? [];
      // On the root's path (an ancestor of it, or the root itself) or somewhere inside it. Any
      // other branch cannot contain the root, so it is not walked at all.
      const onPath = nextParts.every((p, i) => i >= rootParts.length || rootParts[i] === p);
      if (!onPath) continue;

      if (nextParts.length > rootParts.length && isQuestion(row, path, kids.length > 0)) {
        out.push({
          id: row.id,
          title: row.title,
          prompt: row.prompt,
          path,
          url: `/prep/${segment}/${path}`,
          folders: titles.slice(rootParts.length),
          topics: row.topics ?? [],
          companies: row.companies ?? [],
          difficulty: row.difficulty,
          status: row.status,
          frequency: row.frequency ?? 0,
        });
      }
      walk(row.id, nextParts, [...titles, row.title], depth + 1);
    }
  };
  walk(null, [], [], 0);
  return out;
}

// ---------------------------------------------------------------------------
// Search

/**
 * Shorthand people actually type. Each alternative is tried in place of the token, so "dp"
 * finds "Dynamic Programming" folders and "ll cycle" finds "Linked List Cycle".
 */
const ALIASES: Record<string, string[]> = {
  dp: ["dynamic programming"],
  ll: ["linked list"],
  bst: ["binary search tree"],
  bs: ["binary search"],
  pq: ["priority queue", "heap"],
  heap: ["priority queue"],
  dsu: ["union find", "disjoint set"],
  uf: ["union find"],
  lca: ["lowest common ancestor"],
  mst: ["minimum spanning tree"],
  lis: ["longest increasing subsequence"],
  lcs: ["longest common subsequence"],
  topo: ["topological"],
  bfs: ["breadth first"],
  dfs: ["depth first"],
  sw: ["sliding window"],
  kth: ["k th", "kth largest", "kth smallest"],
  db: ["database"],
  kv: ["key value"],
  api: ["rest api"],
  msg: ["message", "messaging"],
  notif: ["notification"],
  "2": ["two"],
  "3": ["three"],
  two: ["2"],
  three: ["3"],
};

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function tokenize(query: string): string[] {
  return normalize(query).split(" ").filter(Boolean);
}

/** Edit distance with transpositions, abandoning early once it exceeds `max`. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
      rowMin = Math.min(rowMin, d[i][j]);
    }
    if (rowMin > max) return max + 1;
  }
  return d[a.length][b.length];
}

type Field = { text: string; words: string[]; compact: string; weight: number };

function field(text: string, weight: number): Field {
  const n = normalize(text);
  return { text: n, words: n.split(" ").filter(Boolean), compact: n.replace(/ /g, ""), weight };
}

/**
 * How well one term matches one field, 0..1.
 *
 * Whole word beats a word prefix ("slid" while typing "sliding") beats a substring of the
 * space-stripped text ("ratelimiter" inside "Design a Rate Limiter") beats a typo ("dijkstar").
 * A multi-word term -- an alias expansion -- has to appear as a phrase.
 */
function termQuality(term: string, f: Field): number {
  if (term.includes(" ")) return ` ${f.text} `.includes(` ${term} `) ? 0.9 : 0;
  let best = 0;
  for (const w of f.words) {
    if (w === term) return 1;
    if (w.startsWith(term)) best = Math.max(best, term.length === 1 ? 0.5 : 0.8);
  }
  if (best > 0) return best;
  if (term.length >= 3 && f.compact.includes(term)) return 0.55;
  if (term.length >= 4) {
    const max = term.length >= 7 ? 2 : 1;
    for (const w of f.words) {
      if (w.length < 3) continue;
      // Compare against the word, and against its prefix of the same length, so a typo made
      // mid-word ("dijks" -> "djiks") still finds "dijkstra" before the word is finished.
      if (editDistance(term, w, max) <= max) return 0.4;
      if (w.length > term.length && editDistance(term, w.slice(0, term.length), max) <= max) {
        return 0.3;
      }
    }
  }
  return 0;
}

export type Searchable = {
  title: string;
  prompt: string | null;
  folders: string[];
  topics: string[];
  companies: string[];
  frequency: number;
};

type Indexed<T> = { item: T; fields: Field[]; title: Field };

export function buildIndex<T extends Searchable>(items: T[]): Indexed<T>[] {
  return items.map((item) => {
    const title = field(item.title, 10);
    return {
      item,
      title,
      fields: [
        title,
        field(item.topics.join(" "), 5),
        field(item.folders.join(" "), 5),
        field(item.companies.join(" "), 4),
        field(item.prompt ?? "", 2),
      ],
    };
  });
}

/**
 * Rank items against a free-text query.
 *
 * Every word must match somewhere (AND across words), in any field and in any order -- title,
 * topics, the folders it sits in, companies that asked it, or its prompt. So "hard graph
 * google" is not a thing, but "graph shortest", "sliding window" and "uber design" all are.
 * Title hits outweigh everything else, and a query that appears verbatim in a title outranks
 * one whose words are merely scattered through it. Ties go to the more frequently asked.
 */
export function searchQuestions<T extends Searchable>(index: Indexed<T>[], query: string): T[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return index.map((i) => i.item);
  const phrase = tokens.join(" ");

  const scored: { item: T; score: number }[] = [];
  for (const entry of index) {
    let total = 0;
    let matchedAll = true;
    for (const token of tokens) {
      const terms = [token, ...(ALIASES[token] ?? [])];
      let best = 0;
      for (const f of entry.fields) {
        for (const term of terms) {
          // An alias is a guess about intent; it should never outrank the literal word.
          const q = termQuality(term, f) * (term === token ? 1 : 0.9);
          best = Math.max(best, q * f.weight);
        }
      }
      if (best === 0) {
        matchedAll = false;
        break;
      }
      total += best;
    }
    if (!matchedAll) continue;
    if (tokens.length > 1 && ` ${entry.title.text} `.includes(` ${phrase}`)) total += 8;
    if (entry.title.text.startsWith(phrase)) total += 4;
    scored.push({ item: entry.item, score: total });
  }

  return scored
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.item.frequency - a.item.frequency ||
        a.item.title.localeCompare(b.item.title),
    )
    .map((s) => s.item);
}

/**
 * Character ranges of `text` to highlight for `query`: word-starts matching a query word or one
 * of its aliases. Typo matches are not highlighted -- there is nothing literal to point at.
 */
export function highlightRanges(text: string, query: string): [number, number][] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];
  const terms = new Set<string>();
  for (const t of tokens) {
    terms.add(t);
    for (const alias of ALIASES[t] ?? []) for (const w of alias.split(" ")) terms.add(w);
  }

  const lower = text.toLowerCase();
  const ranges: [number, number][] = [];
  const wordStart = /[a-z0-9]+/g;
  let m: RegExpExecArray | null;
  while ((m = wordStart.exec(lower))) {
    let longest = 0;
    for (const term of terms) {
      if (term.length > longest && m[0].startsWith(term)) longest = term.length;
    }
    if (longest > 0) ranges.push([m.index, m.index + longest]);
  }
  return ranges;
}
