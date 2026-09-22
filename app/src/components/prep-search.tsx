"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";

import { searchPrep, type PrepSearchGroup } from "@/app/prep/actions";
import { cx } from "./ui";

/**
 * The global search: ⌘K (or a click) from anywhere in the app, grouped results the way the
 * sidebar already reads -- DSA, HLD, LLD, and so on -- rather than one flat list.
 *
 * A single fixed-position component rather than a trigger in the sidebar plus another in the
 * mobile nav. Both of those are conditionally hidden by CSS depending on viewport width, but
 * still mounted either way -- two independent instances would mean two `open` states and a
 * document-level ⌘K listener that could fire twice. One instance, always rendered, sidesteps
 * that entirely.
 */
export function PrepSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<PrepSearchGroup[]>([]);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      // The input isn't in the DOM until this render commits.
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      setQuery("");
      setGroups([]);
    }
  }, [open]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setGroups([]);
      return;
    }
    // Debounced rather than searching on every keystroke -- a query is usually finished typing
    // a beat after the last character, and firing a server action per keystroke would mean most
    // of them get thrown away before their result even renders.
    const handle = setTimeout(() => {
      startTransition(async () => {
        setGroups(await searchPrep(q));
      });
    }, 150);
    return () => clearTimeout(handle);
  }, [query]);

  const showEmpty = query.trim().length >= 2 && !pending && groups.length === 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search preparation pages"
        title="Search (⌘K)"
        className="fixed right-4 top-3 z-40 flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-[12.5px] text-ink-dim shadow-sm transition hover:border-line-strong hover:text-ink md:right-6"
      >
        <SearchIcon />
        <span className="hidden sm:inline">Search</span>
        <kbd className="hidden rounded border border-line bg-surface-2 px-1 text-[10px] text-ink-faint sm:inline">
          ⌘K
        </kbd>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 px-4 pt-[10vh]"
          onClick={() => setOpen(false)}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Search"
            className="flex max-h-[70vh] w-full max-w-lg flex-col overflow-hidden rounded-card border border-line-strong bg-surface shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2.5 border-b border-line px-3.5 py-3">
              <SearchIcon />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search DSA, HLD, LLD, behavioral, companies…"
                className="min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-faint"
              />
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="shrink-0 rounded border border-line px-1.5 py-0.5 text-[10.5px] text-ink-faint transition hover:text-ink"
              >
                Esc
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {query.trim().length < 2 ? (
                <p className="px-2.5 py-6 text-center text-[12.5px] text-ink-faint">
                  Type at least 2 characters to search.
                </p>
              ) : showEmpty ? (
                <p className="px-2.5 py-6 text-center text-[12.5px] text-ink-faint">
                  No pages match &ldquo;{query.trim()}&rdquo;.
                </p>
              ) : (
                groups.map((g) => (
                  <div key={g.label} className="mb-2 last:mb-0">
                    <div className="px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-faint">
                      {g.label}
                    </div>
                    <ul>
                      {g.results.map((r) => (
                        <li key={r.id}>
                          <Link
                            href={r.url}
                            onClick={() => setOpen(false)}
                            className="flex items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-[13px] text-ink-dim transition hover:bg-surface-2 hover:text-ink"
                          >
                            <span className="truncate">{r.title}</span>
                            {r.difficulty && (
                              <span
                                className={cx(
                                  "shrink-0 rounded px-1 text-[10px] font-semibold uppercase",
                                  r.difficulty === "easy" && "bg-fresh-soft text-fresh",
                                  r.difficulty === "medium" && "bg-warn-soft text-warn",
                                  r.difficulty === "hard" && "bg-danger-soft text-danger",
                                )}
                              >
                                {r.difficulty[0]}
                              </span>
                            )}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function SearchIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-3.5 shrink-0 text-ink-faint"
      aria-hidden
      fill="none"
      stroke="currentColor"
    >
      <circle cx="7" cy="7" r="5" strokeWidth="1.5" />
      <path d="M11 11l3.5 3.5" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
