# -*- coding: utf-8 -*-
"""
Import a Notion Markdown export into the prep tree.

Notion's export is already a tree on disk: a page is `Title <32-hex id>.md`, and its children
live in a sibling folder of the same name. That maps straight onto prep_items, where a page
with children *is* a folder -- so the import is a directory walk, not a parser.

Three things have to be rewritten on the way in, and each is a silent failure if skipped:

  titles      the 32-hex id suffix is Notion's, not part of the name
  links       internal links point at .md paths that do not exist here
  images      relative refs that must resolve to something the app actually serves

Emits SQL rather than writing to the database, so the whole import can be read before it runs
and applied identically to local and remote D1.

    python scripts/import_notion_export.py <unzipped-export-dir> --parent-slug hld
"""
from __future__ import annotations

import argparse
import io
import os
import posixpath
import re
import shutil
import sys
import unicodedata
import uuid
from dataclasses import dataclass, field
from urllib.parse import unquote

sys.stdout.reconfigure(encoding="utf-8")

#: Notion appends a 32-character hex id to every exported file and folder name.
NOTION_ID = re.compile(r"[ ]([0-9a-f]{32})(?=$|\.md$)")
MD_LINK = re.compile(r"\[([^\]]*)\]\(([^)]+)\)")
IMG_LINK = re.compile(r"!\[([^\]]*)\]\(([^)]+)\)")

#: Where images are copied to, relative to app/public. Served as static assets by the Worker.
ASSET_DIR = "prep-assets"


def strip_id(name: str) -> tuple[str, str | None]:
    """"Load balancer 22031900ae0080..." -> ("Load balancer", "22031900ae0080...")."""
    base = name[:-3] if name.endswith(".md") else name
    m = NOTION_ID.search(base + (".md" if name.endswith(".md") else ""))
    if m:
        return base[: m.start()].strip(), m.group(1)
    return base.strip(), None


def slugify(title: str) -> str:
    s = unicodedata.normalize("NFKD", title).encode("ascii", "ignore").decode("ascii")
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower()
    return s or "page"


@dataclass
class Page:
    title: str
    notion_id: str | None
    md_path: str            # absolute path on disk
    rel_key: str            # export-relative path, url-decoded, for link resolution
    slug: str = ""
    row_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    parent: "Page | None" = None
    children: list["Page"] = field(default_factory=list)
    body: str = ""

    def path_segments(self) -> list[str]:
        out: list[str] = []
        node: Page | None = self
        while node is not None:
            out.append(node.slug)
            node = node.parent
        return list(reversed(out))


def collect(directory: str, parent: Page | None, rel_prefix: str) -> list[Page]:
    """One level of the export, as pages with their children attached."""
    pages: list[Page] = []
    if not os.path.isdir(directory):
        return pages

    for entry in sorted(os.listdir(directory)):
        if not entry.endswith(".md"):
            continue
        full = os.path.join(directory, entry)
        title, nid = strip_id(entry)
        page = Page(
            title=title,
            notion_id=nid,
            md_path=full,
            rel_key=(rel_prefix + entry),
            parent=parent,
        )
        # A page's children live in a sibling folder named after the *title* -- Notion puts the
        # 32-hex id on the file but not on the folder, so chopping ".md" off the filename finds
        # nothing and the whole import silently yields zero pages.
        child_dir = os.path.join(directory, title)
        page.children = collect(child_dir, page, rel_prefix + os.path.basename(child_dir) + "/")
        pages.append(page)
    return pages


def assign_slugs(pages: list[Page]) -> None:
    """Unique within a parent, which is all the tree needs -- paths resolve level by level."""
    seen: dict[str, int] = {}
    for p in pages:
        base = slugify(p.title)
        n = seen.get(base, 0)
        seen[base] = n + 1
        p.slug = base if n == 0 else f"{base}-{n + 1}"
        assign_slugs(p.children)


def walk(pages: list[Page]):
    for p in pages:
        yield p
        yield from walk(p.children)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("export_dir", help="the unzipped Notion export")
    ap.add_argument("--kind", default="system_design")
    ap.add_argument("--parent-slug", default="hld", help="existing top-level folder to import into")
    ap.add_argument("--app-public", default="app/public")
    ap.add_argument("--out", default="-")
    args = ap.parse_args()

    root_mds = [f for f in os.listdir(args.export_dir) if f.endswith(".md")]
    if len(root_mds) != 1:
        raise SystemExit(f"expected exactly one top-level .md, found {len(root_mds)}: {root_mds}")

    roots = collect(args.export_dir, None, "")
    top = roots[0]

    # The export's root page is the directory itself. Its children become children of the
    # existing HLD folder; the root's own body is a table of contents made entirely of links
    # to those children, which the folder listing already renders. Importing it would put a
    # duplicate index one level deep for no gain.
    imported = top.children
    for p in imported:
        p.parent = None
    assign_slugs(imported)

    all_pages = list(walk(imported))

    # Map every export path to where that page now lives, so internal links can be rewritten.
    by_rel: dict[str, Page] = {}
    for p in all_pages:
        by_rel[p.rel_key] = p
        by_rel[p.rel_key.replace(os.sep, "/")] = p

    prefix = f"/prep/system-design/{args.parent_slug}"
    asset_root = os.path.join(args.app_public, ASSET_DIR)
    os.makedirs(asset_root, exist_ok=True)

    copied = 0
    unresolved_links: list[str] = []

    for p in all_pages:
        raw = io.open(p.md_path, encoding="utf-8").read()

        # Drop the leading "# Title" -- the page renders its own title as a heading already.
        raw = re.sub(r"^#\s+.*\n+", "", raw, count=1)

        page_dir = os.path.join(os.path.dirname(p.md_path), p.title)

        def fix_image(m: re.Match[str]) -> str:
            nonlocal copied
            alt, target = m.group(1), unquote(m.group(2))
            if target.startswith("http"):
                return m.group(0)
            src = os.path.join(os.path.dirname(p.md_path), target)
            if not os.path.isfile(src):
                src = os.path.join(page_dir, os.path.basename(target))
            if not os.path.isfile(src):
                return f"*(missing image: {os.path.basename(target)})*"
            ext = os.path.splitext(src)[1] or ".png"
            name = f"{p.slug}-{copied}{ext}"
            shutil.copyfile(src, os.path.join(asset_root, name))
            copied += 1
            return f"![{alt}](/{ASSET_DIR}/{name})"

        raw = IMG_LINK.sub(fix_image, raw)

        def fix_link(m: re.Match[str]) -> str:
            label, target = m.group(1), m.group(2)
            if target.startswith(("http", "/", "#", "mailto:")):
                return m.group(0)
            key = unquote(target).replace(os.sep, "/")
            # Notion writes internal links relative to the linking page's own directory, not to
            # the export root: the "No sql" page links to "No sql/Key value stores <id>.md".
            # Resolving against the root alone left every child link dead -- 30 of them here.
            here = posixpath.dirname(p.rel_key.replace(os.sep, "/"))
            candidates = [posixpath.normpath(posixpath.join(here, key)), key]
            for candidate in candidates:
                hit = by_rel.get(candidate)
                if hit:
                    return f"[{label}]({prefix}/{'/'.join(hit.path_segments())})"
            if key.endswith(".md"):
                unresolved_links.append(f"{p.title} -> {key}")
                return label  # a dead link is worse than plain text
            return m.group(0)

        raw = MD_LINK.sub(fix_link, raw)
        p.body = raw.strip()

    # ---- SQL -------------------------------------------------------------------------------
    def q(v: str | None) -> str:
        return "NULL" if v is None else "'" + v.replace("'", "''") + "'"

    lines: list[str] = []
    lines.append("-- Generated by scripts/import_notion_export.py. Re-runnable.")
    lines.append(
        "DELETE FROM prep_items WHERE kind = " + q(args.kind) +
        " AND json_extract(content, '$.notionId') IS NOT NULL;"
    )
    parent_expr = (
        "(SELECT id FROM prep_items WHERE kind = " + q(args.kind) +
        " AND slug = " + q(args.parent_slug) + " AND parent_id IS NULL)"
    )

    for i, p in enumerate(all_pages):
        parent_sql = q(p.parent.row_id) if p.parent else parent_expr
        content = '{"notionId": "%s"}' % (p.notion_id or "")
        lines.append(
            "INSERT INTO prep_items (id, kind, slug, title, parent_id, position, body, content, "
            "status, frequency) VALUES ("
            f"{q(p.row_id)}, {q(args.kind)}, {q(p.slug)}, {q(p.title)}, {parent_sql}, {i}, "
            f"{q(p.body)}, {q(content)}, 'not_started', 0);"
        )

    sql = "\n".join(lines) + "\n"
    if args.out == "-":
        sys.stdout.write(sql)
    else:
        io.open(args.out, "w", encoding="utf-8", newline="\n").write(sql)

    depth_counts: dict[int, int] = {}
    for p in all_pages:
        d = len(p.path_segments())
        depth_counts[d] = depth_counts.get(d, 0) + 1

    print(f"\n-- pages: {len(all_pages)}  depths: {depth_counts}", file=sys.stderr)
    print(f"-- images copied to {asset_root}: {copied}", file=sys.stderr)
    if unresolved_links:
        print(f"-- UNRESOLVED LINKS ({len(unresolved_links)}):", file=sys.stderr)
        for u in unresolved_links[:15]:
            print(f"--   {u}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
