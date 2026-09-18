"use client";

import hljs from "highlight.js/lib/common";
import scala from "highlight.js/lib/languages/scala";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";

import { addPageCodeFile, removePageCodeFile } from "@/app/prep/actions";
import { allDirPaths, buildFileTree, type TreeNode } from "@/server/domain/code";
import { cx } from "./ui";

// `lib/common` carries the thirty-odd languages most code is written in, which is every one
// this app maps an extension to except Scala. Registering it here keeps `languageFor` honest:
// a mapping that names a grammar nobody bundled would silently render as plain text.
hljs.registerLanguage("scala", scala);

export type CodeFile = {
  id: string;
  path: string;
  language: string | null;
  content: string;
};

/**
 * The production code for a question, read the way you would read it in an editor.
 *
 * A viewer, not an editor. The code is written elsewhere and pasted here to be *re-read* before
 * an interview, and the moment a pane is editable it inherits every problem an editor has --
 * autosave, conflict, an accidental keystroke silently rewriting the answer you came to revise.
 * So: a file tree, a highlighted pane, and nothing that can change the text.
 *
 * Collapsed on arrival. A question page is read top-down -- prompt, then videos, then the
 * design -- and a few hundred lines of Java unfurled between them would push everything else
 * off the screen for the majority of visits that never open it.
 */
export function CodeWorkspace({
  prepItemId,
  path,
  files,
}: {
  prepItemId: string;
  path: string;
  files: CodeFile[];
}) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);

  return (
    <section className="mb-6">
      <div className="mb-2 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="group flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-faint transition hover:text-ink-dim"
        >
          <span
            className={cx(
              "inline-block text-[9px] leading-none transition-transform",
              open ? "rotate-90" : "rotate-0",
            )}
            aria-hidden
          >
            ▶
          </span>
          Code
          {files.length > 0 && (
            <span className="font-normal normal-case tracking-normal text-ink-faint">
              · {files.length} file{files.length === 1 ? "" : "s"}
            </span>
          )}
        </button>

        {open && files.length > 0 && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="flex items-center gap-1.5 text-[12px] text-ink-dim transition hover:text-ink"
            title="Open full screen"
          >
            <ExpandIcon />
            Expand
          </button>
        )}
      </div>

      {open && (
        <Workspace
          prepItemId={prepItemId}
          path={path}
          files={files}
          height="h-[26rem]"
        />
      )}

      {expanded && (
        <Modal onClose={() => setExpanded(false)} title="Code">
          <Workspace prepItemId={prepItemId} path={path} files={files} height="h-full" />
        </Modal>
      )}
    </section>
  );
}

/**
 * The explorer and the pane.
 *
 * Rendered twice -- inline and in the modal -- as two independent instances rather than one
 * moved between containers. They therefore keep their own selection, which is what you want:
 * expanding to full screen to chase a class through three files should not scroll the small
 * copy underneath to somewhere you did not ask for.
 */
function Workspace({
  prepItemId,
  path,
  files,
  height,
}: {
  prepItemId: string;
  path: string;
  files: CodeFile[];
  height: string;
}) {
  const tree = useMemo(() => buildFileTree(files), [files]);
  const [activeId, setActiveId] = useState<string | null>(files[0]?.id ?? null);
  const [openDirs, setOpenDirs] = useState<Set<string>>(
    () => new Set(allDirPaths(tree)),
  );
  const [adding, setAdding] = useState(false);
  const [pending, startTransition] = useTransition();

  // A file removed elsewhere, or the last one deleted, must not leave a stale selection
  // pointing at a row that no longer exists -- the pane would render the previous file forever.
  const active = files.find((f) => f.id === activeId) ?? files[0] ?? null;

  const toggleDir = useCallback((dirPath: string) => {
    setOpenDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) next.delete(dirPath);
      else next.add(dirPath);
      return next;
    });
  }, []);

  if (files.length === 0) {
    return (
      <div className="rounded-card border border-line bg-surface">
        <p className="border-b border-line px-3.5 py-3 text-[12px] text-ink-faint">
          No code yet. Add the files for this design and they will open here like an editor.
        </p>
        <div className="p-3">
          <AddFileForm
            prepItemId={prepItemId}
            path={path}
            pending={pending}
            startTransition={startTransition}
            onDone={() => setAdding(false)}
            alwaysOpen
          />
        </div>
      </div>
    );
  }

  return (
    <div
      className={cx(
        "flex overflow-hidden rounded-card border border-line bg-surface",
        height,
      )}
    >
      {/* Explorer */}
      <aside className="flex w-48 shrink-0 flex-col border-r border-line bg-surface-2 sm:w-56">
        <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-faint">
            Explorer
          </span>
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            title={adding ? "Cancel" : "Add a file"}
            className="rounded px-1 text-[15px] leading-none text-ink-faint transition hover:text-ink"
          >
            {adding ? "×" : "+"}
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto py-1">
          <FileTree
            nodes={tree}
            depth={0}
            activeId={active?.id ?? null}
            openDirs={openDirs}
            onToggleDir={toggleDir}
            onSelect={setActiveId}
          />
        </div>
      </aside>

      {/* Pane */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-line bg-surface-2 px-3 py-2">
          <span className="truncate font-mono text-[12px] text-ink-dim" title={active?.path}>
            {active?.path}
          </span>
          <div className="flex shrink-0 items-center gap-2">
            {active?.language && (
              <span className="text-[10.5px] uppercase tracking-wide text-ink-faint">
                {active.language}
              </span>
            )}
            {active && (
              <>
                <CopyButton text={active.content} />
                <button
                  type="button"
                  onClick={() =>
                    startTransition(async () => {
                      await removePageCodeFile(active.id, path);
                    })
                  }
                  disabled={pending}
                  title="Remove this file"
                  className="rounded px-1 text-[14px] leading-none text-ink-faint transition hover:text-danger disabled:opacity-50"
                >
                  ×
                </button>
              </>
            )}
          </div>
        </div>

        {adding && (
          <div className="border-b border-line bg-surface-2 p-3">
            <AddFileForm
              prepItemId={prepItemId}
              path={path}
              pending={pending}
              startTransition={startTransition}
              onDone={() => setAdding(false)}
            />
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto">
          {active ? <CodeView file={active} /> : null}
        </div>
      </div>

    </div>
  );
}

/**
 * One file, with a line-number gutter.
 *
 * The gutter is a sibling column rather than a `::before` counter on each line, because
 * highlight.js returns one HTML string whose spans routinely cross line boundaries -- a block
 * comment, a template literal -- so splitting that output into per-line elements would tear the
 * markup. Two columns sharing a line-height stay aligned without touching the highlighted HTML
 * at all, and the gutter sticks to the left so it survives a horizontal scroll.
 */
function CodeView({ file }: { file: CodeFile }) {
  const html = useMemo(() => highlight(file), [file]);
  const lines = useMemo(() => file.content.split("\n").length, [file.content]);

  return (
    <div className="flex min-w-max text-[12.5px] leading-[1.6]">
      <pre
        aria-hidden
        className="sticky left-0 z-10 select-none border-r border-line bg-surface px-3 py-3 text-right font-mono text-ink-faint"
      >
        {Array.from({ length: lines }, (_, i) => i + 1).join("\n")}
      </pre>
      <pre className="px-4 py-3 font-mono text-ink-dim">
        <code
          className="hljs-code"
          // highlight.js escapes the source it is given, and the fallback escapes by hand, so
          // neither branch can emit markup that came from the stored file.
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </pre>
    </div>
  );
}

function highlight(file: CodeFile): string {
  const lang = file.language;
  // Ask the registry rather than trusting the stored value: the column is free text, and a
  // language that is not bundled must degrade to plain code, never throw in render.
  if (lang && hljs.getLanguage(lang)) {
    try {
      return hljs.highlight(file.content, { language: lang, ignoreIllegals: true }).value;
    } catch {
      // Fall through to plain text -- a grammar that chokes is not worth an error boundary.
    }
  }
  return escapeHtml(file.content);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ---------------------------------------------------------------------------

function FileTree({
  nodes,
  depth,
  activeId,
  openDirs,
  onToggleDir,
  onSelect,
}: {
  nodes: TreeNode[];
  depth: number;
  activeId: string | null;
  openDirs: Set<string>;
  onToggleDir: (path: string) => void;
  onSelect: (id: string) => void;
}) {
  return (
    <ul>
      {nodes.map((node) => {
        const pad = { paddingLeft: `${depth * 12 + 10}px` };

        if (node.kind === "dir") {
          const isOpen = openDirs.has(node.path);
          return (
            <li key={node.path}>
              <button
                type="button"
                onClick={() => onToggleDir(node.path)}
                aria-expanded={isOpen}
                style={pad}
                className="flex w-full items-center gap-1.5 py-[3px] pr-2 text-left text-[12.5px] text-ink-dim transition hover:bg-surface-3 hover:text-ink"
              >
                <span
                  className={cx(
                    "inline-block w-2 shrink-0 text-[8px] leading-none transition-transform",
                    isOpen ? "rotate-90" : "rotate-0",
                  )}
                  aria-hidden
                >
                  ▶
                </span>
                <span className="truncate">{node.name}</span>
              </button>
              {isOpen && (
                <FileTree
                  nodes={node.children}
                  depth={depth + 1}
                  activeId={activeId}
                  openDirs={openDirs}
                  onToggleDir={onToggleDir}
                  onSelect={onSelect}
                />
              )}
            </li>
          );
        }

        const isActive = node.id === activeId;
        return (
          <li key={node.id}>
            <button
              type="button"
              onClick={() => onSelect(node.id)}
              aria-current={isActive ? "true" : undefined}
              style={pad}
              className={cx(
                "flex w-full items-center gap-1.5 py-[3px] pr-2 text-left text-[12.5px] transition",
                isActive
                  ? "bg-accent-soft text-accent-ink"
                  : "text-ink-dim hover:bg-surface-3 hover:text-ink",
              )}
              title={node.path}
            >
              <span className="w-2 shrink-0" aria-hidden />
              <span className="truncate">{node.name}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------

/**
 * Full-screen reading.
 *
 * Escape closes it and the page behind it stops scrolling while it is open -- without the lock,
 * a wheel gesture over the backdrop scrolls the article underneath, so closing the modal leaves
 * you somewhere you never navigated to.
 */
function Modal({
  children,
  onClose,
  title,
}: {
  children: React.ReactNode;
  onClose: () => void;
  title: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 sm:p-6"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        // 92% of each axis -- comfortably past the "more than 80%" this is for, while leaving
        // enough backdrop that clicking out is still an obvious escape.
        className="flex h-[92vh] w-[95vw] flex-col overflow-hidden rounded-card border border-line-strong bg-surface shadow-2xl sm:h-[90vh] sm:w-[92vw]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-faint">
            {title}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-1.5 text-[16px] leading-none text-ink-faint transition hover:text-ink"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="min-h-0 flex-1 p-3">{children}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function AddFileForm({
  prepItemId,
  path,
  pending,
  startTransition,
  onDone,
  alwaysOpen = false,
}: {
  prepItemId: string;
  path: string;
  pending: boolean;
  startTransition: (cb: () => void) => void;
  onDone: () => void;
  alwaysOpen?: boolean;
}) {
  return (
    <form
      action={(fd) => {
        startTransition(async () => {
          await addPageCodeFile(fd);
          onDone();
        });
      }}
      className="space-y-2"
    >
      <input type="hidden" name="prepItemId" value={prepItemId} />
      <input type="hidden" name="path" value={path} />
      <input
        name="filePath"
        required
        autoFocus={!alwaysOpen}
        placeholder="src/model/Vehicle.java"
        className="w-full rounded-md border border-line bg-surface px-2.5 py-1.5 font-mono text-[12.5px] text-ink outline-none focus:border-accent"
      />
      <textarea
        name="content"
        required
        rows={alwaysOpen ? 6 : 8}
        placeholder="Paste the file's contents"
        className="w-full resize-y rounded-md border border-line bg-surface px-2.5 py-1.5 font-mono text-[12.5px] leading-relaxed text-ink outline-none focus:border-accent"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-accent bg-accent-soft px-3 py-1.5 text-[13px] text-accent-ink transition hover:border-accent-strong disabled:opacity-60"
      >
        Add file
      </button>
    </form>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        } catch {
          // A denied clipboard permission is not worth an error state; the text is on screen.
        }
      }}
      className="text-[11.5px] text-ink-faint transition hover:text-ink"
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}

function ExpandIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden fill="none" stroke="currentColor">
      <path
        d="M6 2H2v4M10 14h4v-4M14 6V2h-4M2 10v4h4"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
