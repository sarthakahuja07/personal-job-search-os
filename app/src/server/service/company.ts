/**
 * A company's prep folder: create it, and keep its generated pages current.
 *
 * The shape is fixed on purpose -- Notes, Question Bank, DSA, HLD, LLD -- so every company
 * reads the same way and an assistant never has to invent a layout. Three of those five are
 * generated from structured input rather than written, which is what keeps them honest: a
 * question bank typed as prose drifts, and a list of links typed by hand rots the first time
 * a page is renamed.
 *
 * Resolution is the part worth care. A model knows a question's *title*; only the database
 * knows whether a page for it exists and where. So titles come in and links go out, and a
 * title with no page is reported rather than quietly dropped.
 */

import type { Db } from "@/db";
import type { PrepKind } from "@/db/schema";
import {
  COMPANY_PAGES,
  DISCIPLINE_SOURCE,
  DISCIPLINE_TITLE,
  renderQuestionBank,
  renderQuestionIndex,
  type BankEntry,
  type Discipline,
  type QuestionLink,
} from "@/server/domain/company";
import { buildPaths } from "@/server/domain/prep";
import {
  allPagePaths,
  insertPage,
  nextPosition,
  pageBySlug,
  updatePage,
} from "@/server/repository/prep-repo";
import { slugify } from "@/server/service/prep-import";

export class CompanyNotFoundError extends Error {}

/** The company folder plus its five pages, created only where they are missing. */
export async function scaffoldCompany(db: Db, name: string) {
  const slug = slugify(name);

  let folder = await pageBySlug(db, "company", null, slug);
  let created = false;
  if (!folder) {
    folder = await insertPage(db, {
      kind: "company",
      slug,
      title: name,
      parentId: null,
      position: await nextPosition(db, null),
      content: {},
    });
    created = true;
  }

  const pages: { slug: string; title: string; created: boolean; url: string }[] = [];
  for (const page of COMPANY_PAGES) {
    const existing = await pageBySlug(db, "company", folder.id, page.slug);
    if (!existing) {
      await insertPage(db, {
        kind: "company",
        slug: page.slug,
        title: page.title,
        parentId: folder.id,
        position: await nextPosition(db, folder.id),
        // Seeded empty rather than with placeholder prose. A page that says "nothing here yet"
        // is indistinguishable from one whose content failed to write.
        body: null,
        content: {},
      });
    }
    pages.push({
      slug: page.slug,
      title: page.title,
      created: !existing,
      url: `/prep/company/${slug}/${page.slug}`,
    });
  }

  return {
    company: name,
    slug,
    created,
    url: `/prep/company/${slug}`,
    pages,
  };
}

/** The company folder, or a clear failure naming what to do about it. */
async function requireCompany(db: Db, name: string) {
  const folder = await pageBySlug(db, "company", null, slugify(name));
  if (!folder) {
    throw new CompanyNotFoundError(
      `No company page for ${name}. Call company_scaffold first to create it.`,
    );
  }
  return folder;
}

/** Overwrite one of a company's generated pages. */
async function writeGenerated(
  db: Db,
  companyId: string,
  slug: string,
  title: string,
  body: string,
) {
  const existing = await pageBySlug(db, "company", companyId, slug);
  if (existing) {
    await updatePage(db, existing.id, { body, title });
    return { id: existing.id, created: false };
  }
  const page = await insertPage(db, {
    kind: "company",
    slug,
    title,
    parentId: companyId,
    position: await nextPosition(db, companyId),
    body,
    content: {},
  });
  return { id: page.id, created: true };
}

/**
 * Match question titles against real pages.
 *
 * Exact slug match first, then a contains match on the title -- a model writes "Design a rate
 * limiter" where the page is called "Rate Limiter", and refusing to link those would make the
 * feature useless while looking like it worked.
 */
async function resolve(
  db: Db,
  discipline: Discipline,
  titles: { title: string; frequency?: number; lastAsked?: string | null }[],
): Promise<QuestionLink[]> {
  const source = DISCIPLINE_SOURCE[discipline];
  const rows = await allPagePaths(db);
  const paths = buildPaths(rows);

  // Only pages in the right tree are candidates. An LLD question must not resolve to an HLD
  // page with a similar name -- they are different answers to similarly worded prompts.
  const candidates = rows
    .map((r) => ({ ...r, path: paths.get(r.id) ?? r.slug }))
    .filter((r) => {
      if (r.kind !== (source.kind as PrepKind)) return false;
      return source.parentPath ? r.path.startsWith(`${source.parentPath}/`) : true;
    });

  return titles.map((entry) => {
    const wanted = slugify(entry.title);
    const exact = candidates.find((c) => c.slug === wanted);
    const loose =
      exact ??
      candidates.find((c) => {
        const a = c.title.toLowerCase();
        const b = entry.title.toLowerCase();
        return a.includes(b) || b.includes(a);
      });

    return {
      title: entry.title,
      path: loose ? `${segmentFor(loose.kind)}/${loose.path}` : null,
      frequency: entry.frequency,
      lastAsked: entry.lastAsked ?? null,
    };
  });
}

/** URL segment for a kind. Only the two that hold questions are reachable from here. */
const segmentFor = (kind: PrepKind) => (kind === "system_design" ? "system-design" : kind);

export async function publishQuestionBank(db: Db, company: string, entries: BankEntry[]) {
  const folder = await requireCompany(db, company);

  // Bank rows are linked too, using the same resolution as the index pages, so the two views
  // of the same question can never point at different places.
  const resolved: BankEntry[] = [];
  for (const discipline of ["dsa", "hld", "lld"] as Discipline[]) {
    const forKind = entries.filter((e) => e.discipline === discipline);
    if (forKind.length === 0) continue;
    const links = await resolve(
      db,
      discipline,
      forKind.map((e) => ({
        title: e.question,
        frequency: e.frequency,
        lastAsked: e.lastAsked,
      })),
    );
    forKind.forEach((entry, i) => resolved.push({ ...entry, path: links[i].path }));
  }

  const body = renderQuestionBank(folder.title, resolved);
  const result = await writeGenerated(db, folder.id, "question-bank", "Question Bank", body);

  return {
    company: folder.title,
    url: `/prep/company/${folder.slug}/question-bank`,
    entries: resolved.length,
    linked: resolved.filter((e) => e.path).length,
    unlinked: resolved.filter((e) => !e.path).map((e) => e.question),
    ...result,
  };
}

export async function publishQuestionIndex(
  db: Db,
  company: string,
  discipline: Discipline,
  questions: { title: string; frequency?: number; lastAsked?: string | null }[],
) {
  const folder = await requireCompany(db, company);
  const links = await resolve(db, discipline, questions);
  const body = renderQuestionIndex(folder.title, discipline, links);
  const result = await writeGenerated(
    db,
    folder.id,
    discipline,
    DISCIPLINE_TITLE[discipline],
    body,
  );

  return {
    company: folder.title,
    discipline,
    url: `/prep/company/${folder.slug}/${discipline}`,
    questions: links.length,
    linked: links.filter((q) => q.path).length,
    // Named, not counted. These are the questions with no page yet, which is the list of what
    // to write next -- the single most actionable thing this call produces.
    unlinked: links.filter((q) => !q.path).map((q) => q.title),
    ...result,
  };
}
