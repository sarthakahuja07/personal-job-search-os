/**
 * Publishing a page written elsewhere -- by an assistant during a study session.
 *
 * The rules that make this safe to hand to a model live here rather than in the caller, because
 * the caller is the thing that cannot be trusted to follow them:
 *
 *   - A page is placed by *path*, not by id. A model has no way to know a UUID.
 *   - A duplicate is refused by default, never silently overwritten or silently duplicated.
 *   - Resources are classified by the same code that classifies a pasted link, so a YouTube URL
 *     arriving from an assistant becomes a video with its id extracted, exactly as if it had
 *     been pasted by hand.
 *
 * The one thing deliberately *not* enforced: which `content` fields suit which `kind`. That
 * mapping is `KINDS`, and restating it here would mean two places to edit to add a discipline.
 */

import type { Db } from "@/db";
import type { NewPrepItem, PrepContent, PrepKind } from "@/db/schema";
import { parseResource } from "@/server/domain/resources";
import {
  addResource,
  insertPage,
  nextPosition,
  pageBySlug,
  resolvePath,
  updatePage,
} from "@/server/repository/prep-repo";
import type { PrepPageInput } from "@/server/schemas/prep-import";

export class ParentNotFoundError extends Error {}
export class PageExistsError extends Error {}

/**
 * A URL-safe slug, matching the one the Notion import produces.
 *
 * Stability matters more than prettiness: the slug is the page's address, so the same title
 * must always yield the same slug or links rot on re-import.
 */
export function slugify(title: string): string {
  const s = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  // A title of pure punctuation still needs an address.
  return s || "page";
}

/** Strip the nulls a JSON payload uses for "not set" so they do not overwrite real values. */
function definedOnly(content: PrepPageInput["content"]): PrepContent {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(content ?? {})) {
    if (v !== null && v !== undefined && v !== "") out[k] = v;
  }
  return out as PrepContent;
}

export type PublishResult = {
  id: string;
  kind: PrepKind;
  slug: string;
  title: string;
  path: string;
  url: string;
  created: boolean;
  resources: number;
};

export async function publishPrepPage(
  db: Db,
  input: PrepPageInput,
  segmentOf: (kind: PrepKind) => string,
): Promise<PublishResult> {
  const segments = input.parent_path ? input.parent_path.split("/").filter(Boolean) : [];

  const parent = segments.length ? await resolvePath(db, input.kind, segments) : null;
  if (segments.length && !parent) {
    throw new ParentNotFoundError(
      `No page at ${input.kind}/${segments.join("/")}. Create it first, or publish to the top level.`,
    );
  }
  const parentId = parent?.id ?? null;

  const slug = slugify(input.title);
  const existing = await pageBySlug(db, input.kind, parentId, slug);

  if (existing && input.on_conflict === "error") {
    throw new PageExistsError(
      `${input.title} already exists at ${[input.kind, ...segments].join("/")}. ` +
        `Publish with on_conflict "merge" to add to it, or "replace" to overwrite it.`,
    );
  }

  const content = definedOnly(input.content);
  const fields = {
    title: input.title,
    prompt: input.prompt ?? null,
    difficulty: input.difficulty ?? null,
    frequency: input.frequency,
    topics: input.topics,
    companies: input.companies,
    body: input.body ?? null,
    status: input.status,
    sourceUrl: input.source_url ?? null,
  };

  let id: string;
  let created: boolean;

  if (existing && input.on_conflict === "merge") {
    // Merge keeps what the page already has and lets the new payload fill gaps. Overwriting a
    // body you wrote by hand with a model's second pass at the same topic is the one outcome
    // nobody wants from a tool called "merge".
    id = existing.id;
    created = false;
    await updatePage(db, id, {
      prompt: existing.prompt ?? fields.prompt,
      difficulty: existing.difficulty ?? fields.difficulty,
      frequency: existing.frequency || fields.frequency,
      topics: [...new Set([...(existing.topics ?? []), ...fields.topics])],
      companies: [...new Set([...(existing.companies ?? []), ...fields.companies])],
      body: existing.body ?? fields.body,
      sourceUrl: existing.sourceUrl ?? fields.sourceUrl,
      content: { ...(existing.content ?? {}), ...content },
    });
  } else if (existing) {
    id = existing.id;
    created = false;
    await updatePage(db, id, { ...fields, content });
  } else {
    const row: NewPrepItem = {
      kind: input.kind,
      slug,
      parentId,
      position: await nextPosition(db, parentId),
      content,
      ...fields,
    };
    const page = await insertPage(db, row);
    id = page.id;
    created = true;
  }

  // Resources are additive in every mode. A link is never the thing you wanted to delete, and
  // `addResource` already ignores one that is present, so re-publishing is idempotent.
  let position = 0;
  for (const r of input.resources) {
    const parsed = parseResource(r.url, r.title);
    await addResource(db, {
      prepItemId: id,
      kind: parsed.kind,
      url: parsed.url,
      title: parsed.suggestedTitle,
      source: parsed.source,
      videoId: parsed.videoId,
      position: position++,
    });
  }

  const path = [...segments, slug].join("/");
  return {
    id,
    kind: input.kind,
    slug,
    title: input.title,
    path,
    url: `/prep/${segmentOf(input.kind)}/${path}`,
    created,
    resources: input.resources.length,
  };
}
