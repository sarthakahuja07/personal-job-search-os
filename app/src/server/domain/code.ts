/**
 * The code workspace attached to a design question.
 *
 * Two pure pieces: what language a file is, and what folder tree a flat list of paths makes.
 * Both are here rather than in the component because both are ordinary logic with edge cases
 * worth testing -- and because the component is a client bundle, where anything untested is
 * only discoverable by clicking.
 */

/**
 * Extension to highlight.js language id.
 *
 * Deliberately a short list. Every entry costs a grammar in the browser bundle, and an LLD
 * answer is written in one of a handful of languages; anything else still renders, just without
 * colour, which is a far better outcome than shipping every grammar highlight.js publishes.
 */
const LANGUAGE_BY_EXT: Record<string, string> = {
  java: "java",
  py: "python",
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  go: "go",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hh: "cpp",
  cs: "csharp",
  kt: "kotlin",
  kts: "kotlin",
  rs: "rust",
  rb: "ruby",
  php: "php",
  swift: "swift",
  scala: "scala",
  sql: "sql",
  json: "json",
  yml: "yaml",
  yaml: "yaml",
  xml: "xml",
  html: "xml",
  htm: "xml",
  svg: "xml",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  md: "markdown",
  markdown: "markdown",
};

/** Files that carry their language in the name rather than an extension. */
const LANGUAGE_BY_NAME: Record<string, string> = {
  dockerfile: "bash",
  makefile: "bash",
};

/**
 * The highlight.js language for a path, or null when nothing sensible applies.
 *
 * Null rather than a "plaintext" default so the caller can tell "this is prose" from "we do not
 * know" -- the viewer renders both the same way, but a stored null can later be corrected by
 * hand where a stored "plaintext" looks like a decision someone made.
 */
export function languageFor(path: string): string | null {
  const name = (path.split("/").pop() ?? "").toLowerCase();
  if (!name) return null;

  const byName = LANGUAGE_BY_NAME[name];
  if (byName) return byName;

  // A dotfile like ".gitignore" has no extension: the leading dot starts the name.
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null;

  return LANGUAGE_BY_EXT[name.slice(dot + 1)] ?? null;
}

/**
 * Normalise a path typed by a human into the one form stored.
 *
 * Leading slashes and `./`, duplicate separators and stray whitespace all describe the same
 * file, and the unique index would happily store each of them as a different one.
 */
export function normalizeCodePath(raw: string): string {
  return raw
    .trim()
    .replace(/\\/g, "/")
    .split("/")
    .filter((seg) => seg !== "" && seg !== ".")
    .join("/");
}

export type CodeFileRef = { id: string; path: string };

export type TreeNode =
  | { kind: "dir"; name: string; path: string; children: TreeNode[] }
  | { kind: "file"; name: string; path: string; id: string };

/**
 * A flat list of paths as a folder tree.
 *
 * Derived, never stored, so the tree cannot drift from the files. Folders sort before files and
 * both sort by name, which is what every file explorer does and therefore the only ordering
 * that does not read as a bug.
 */
export function buildFileTree(files: CodeFileRef[]): TreeNode[] {
  const root: TreeNode[] = [];

  for (const file of files) {
    const segments = file.path.split("/").filter(Boolean);
    if (segments.length === 0) continue;

    let level = root;
    let prefix = "";

    // Every segment but the last is a folder; create it once and walk into it.
    for (const segment of segments.slice(0, -1)) {
      prefix = prefix ? `${prefix}/${segment}` : segment;
      let dir = level.find(
        (n): n is Extract<TreeNode, { kind: "dir" }> =>
          n.kind === "dir" && n.name === segment,
      );
      if (!dir) {
        dir = { kind: "dir", name: segment, path: prefix, children: [] };
        level.push(dir);
      }
      level = dir.children;
    }

    const name = segments[segments.length - 1];
    level.push({ kind: "file", name, path: file.path, id: file.id });
  }

  return sortTree(root);
}

function sortTree(nodes: TreeNode[]): TreeNode[] {
  nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const node of nodes) {
    if (node.kind === "dir") sortTree(node.children);
  }
  return nodes;
}

/** Every folder path in a tree, so the explorer can open them all by default. */
export function allDirPaths(nodes: TreeNode[]): string[] {
  const out: string[] = [];
  const walk = (list: TreeNode[]) => {
    for (const n of list) {
      if (n.kind === "dir") {
        out.push(n.path);
        walk(n.children);
      }
    }
  };
  walk(nodes);
  return out;
}
