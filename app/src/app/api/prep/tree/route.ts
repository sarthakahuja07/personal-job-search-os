import { getDb } from "@/db";
import { requirePrepToken } from "@/server/auth";
import { buildPaths, KINDS } from "@/server/domain/prep";
import { allPagePaths } from "@/server/repository/prep-repo";

/**
 * GET /api/prep/tree — every folder path a page can be published into.
 *
 * Exists because `parent_path` is the one field an assistant cannot guess. Without this it
 * either invents a plausible-looking path and gets a 404, or gives up and publishes everything
 * to the root, which is how a tree stops being one.
 */
export async function GET(request: Request): Promise<Response> {
  const auth = requirePrepToken(request);
  if (!auth.ok) return auth.response;

  const rows = await allPagePaths(getDb());
  const paths = buildPaths(rows);
  const hasChildren = new Set(rows.map((r) => r.parentId).filter(Boolean) as string[]);
  /** Kinds whose tree has depth, so their top level is sections rather than notes. */
  const nested = new Set(rows.filter((r) => r.parentId !== null).map((r) => r.kind));

  const pathOf = (id: string) => paths.get(id) ?? "";

  return Response.json({
    kinds: KINDS.map((k) => ({
      kind: k.kind,
      segment: k.segment,
      title: k.title,
      fields: k.fields.map((f) => ({ key: f.key, label: f.label, hint: f.hint })),
    })),
    /*
      Somewhere a page can be published into.

      "Has children" is the obvious rule and it fails the one case that matters: an empty folder
      is exactly where you publish *first*. LLD was a section with nothing in it yet, so the
      obvious rule hid the only path an assistant actually needed.

      Two refinements were tried and both were wrong. "Also every top-level page" floods the list
      with all 36 DSA and behavioral notes, because those disciplines are flat and every note is
      top level. "Also anything without a prompt or content" lets HLD's question pages through,
      because they keep their notes in `body`.

      The honest distinction is structural, not textual: a kind whose tree has depth has real
      sections at its top level, and a flat kind has only notes there. So take pages with
      children, plus the top level of the kinds that nest.
    */
    folders: rows
      .filter((r) => hasChildren.has(r.id) || (r.parentId === null && nested.has(r.kind)))
      .map((r) => ({ kind: r.kind, title: r.title, parent_path: pathOf(r.id) })),
  });
}

export const dynamic = "force-dynamic";
