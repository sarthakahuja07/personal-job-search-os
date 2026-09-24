"use client";

import Link from "next/link";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import type { PrepDifficulty, PrepStatus } from "@/db/schema";
import {
  DIFFICULTY_ORDER,
  DIFFICULTY_TONE,
  STATUS_LABEL,
  STATUS_ORDER,
} from "@/server/domain/prep";
import {
  buildIndex,
  highlightRanges,
  searchQuestions,
  type Question,
} from "@/server/domain/prep-questions";
import { Badge, EmptyState, cx } from "./ui";

const STATUS_TONE: Record<PrepStatus, "neutral" | "accent" | "fresh" | "warn"> = {
  not_started: "neutral",
  in_progress: "accent",
  done: "fresh",
  revisit: "warn",
};

function Highlighted({ text, query }: { text: string; query: string }) {
  const ranges = highlightRanges(text, query);
  if (ranges.length === 0) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let at = 0;
  ranges.forEach(([start, end], i) => {
    if (start > at) parts.push(text.slice(at, start));
    parts.push(
      <mark key={i} className="rounded-sm bg-accent-soft px-px text-accent-ink">
        {text.slice(start, end)}
      </mark>,
    );
    at = end;
  });
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}

/**
 * Every question in a discipline or folder, with a search that ranks as you type.
 *
 * Client-side on purpose: the whole list is a few hundred rows that are already on the page, so
 * searching them locally is instant and costs no D1 query per keystroke. The query is mirrored
 * into `?q=` so a search survives a refresh and the back button from a question.
 *
 * Unsearched, questions are grouped under the folder they live in, in sidebar order. Searched,
 * grouping gives way to a single list ranked by relevance -- the best match belongs at the top,
 * not at the top of whichever folder happens to come first.
 */
export function QuestionBrowser({
  questions,
  initialQuery = "",
  hasDifficulty = true,
}: {
  questions: Question[];
  initialQuery?: string;
  hasDifficulty?: boolean;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [difficulty, setDifficulty] = useState<PrepDifficulty | null>(null);
  const [status, setStatus] = useState<PrepStatus | null>(null);
  const deferred = useDeferredValue(query);
  const input = useRef<HTMLInputElement>(null);

  const index = useMemo(() => buildIndex(questions), [questions]);

  const results = useMemo(() => {
    return searchQuestions(index, deferred).filter(
      (q) => (!difficulty || q.difficulty === difficulty) && (!status || q.status === status),
    );
  }, [index, deferred, difficulty, status]);

  const searching = deferred.trim().length > 0;

  // Mirror the query into the URL without a navigation: this page is server-rendered, and a
  // router push per keystroke would refetch it every time.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (deferred.trim()) url.searchParams.set("q", deferred.trim());
    else url.searchParams.delete("q");
    window.history.replaceState(window.history.state, "", url);
  }, [deferred]);

  // "/" focuses the search, as on most sites with one; ignored while typing somewhere else.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      e.preventDefault();
      input.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const groups = useMemo(() => {
    if (searching) return [{ label: "", items: results }];
    const byLabel = new Map<string, Question[]>();
    for (const q of results) {
      const label = q.folders[0] ?? "";
      byLabel.set(label, [...(byLabel.get(label) ?? []), q]);
    }
    return [...byLabel.entries()].map(([label, items]) => ({ label, items }));
  }, [results, searching]);

  const showDifficulty = hasDifficulty && questions.some((q) => q.difficulty);
  const anyFilter = Boolean(query || difficulty || status);

  const chip = (active: boolean) =>
    cx(
      "rounded-md border px-2 py-0.5 text-[12px] transition",
      active
        ? "border-accent bg-accent-soft text-accent-ink"
        : "border-line bg-surface-2 text-ink-dim hover:border-line-strong hover:text-ink",
    );

  return (
    <section className="mb-6">
      <div className="relative mb-2.5">
        <svg
          aria-hidden
          viewBox="0 0 20 20"
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <circle cx="9" cy="9" r="5.5" />
          <path d="m13.5 13.5 3.5 3.5" strokeLinecap="round" />
        </svg>
        <input
          ref={input}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setQuery("");
          }}
          placeholder={`Search ${questions.length} questions — title, topic, pattern, company…`}
          aria-label="Search questions"
          className="w-full rounded-card border border-line bg-surface px-9 py-2.5 text-[14px] text-ink outline-none transition placeholder:text-ink-faint focus:border-accent"
        />
        <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-line px-1.5 text-[11px] text-ink-faint sm:block">
          /
        </kbd>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {showDifficulty &&
          DIFFICULTY_ORDER.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDifficulty(difficulty === d ? null : d)}
              className={chip(difficulty === d)}
            >
              {d}
            </button>
          ))}
        {showDifficulty && <span className="mx-1 h-4 w-px bg-line" aria-hidden />}
        {STATUS_ORDER.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(status === s ? null : s)}
            className={chip(status === s)}
          >
            {STATUS_LABEL[s]}
          </button>
        ))}
        <span className="tnum ml-auto text-[12px] text-ink-faint">
          {results.length === questions.length
            ? `${questions.length} question${questions.length === 1 ? "" : "s"}`
            : `${results.length} of ${questions.length}`}
          {anyFilter && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setDifficulty(null);
                setStatus(null);
              }}
              className="ml-2 text-ink-faint underline-offset-2 transition hover:text-ink-dim hover:underline"
            >
              Clear
            </button>
          )}
        </span>
      </div>

      {results.length === 0 ? (
        <EmptyState
          title={questions.length === 0 ? "No questions here yet" : "Nothing matches"}
          body={
            questions.length === 0
              ? "Questions published into this folder, at any depth, will be listed here."
              : "Try fewer words, a topic (\"graph\", \"caching\"), a pattern, or a company."
          }
        />
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <div key={g.label || "_"}>
              {g.label && groups.length > 1 && (
                <h3 className="mb-1.5 flex items-baseline justify-between text-[12px] font-medium uppercase tracking-wide text-ink-faint">
                  <span>{g.label}</span>
                  <span className="tnum font-normal normal-case tracking-normal">
                    {g.items.length}
                  </span>
                </h3>
              )}
              <ul className="space-y-1.5">
                {g.items.map((q) => {
                  // Grouped, the group heading already names the first folder.
                  const crumb = searching ? q.folders : q.folders.slice(1);
                  return (
                    <li key={q.id}>
                      <Link
                        href={q.url}
                        className="flex items-start justify-between gap-3 rounded-card border border-line bg-surface px-3.5 py-2.5 transition hover:border-line-strong"
                      >
                        <span className="min-w-0">
                          <span className="block text-[14px] text-ink">
                            <Highlighted text={q.title} query={deferred} />
                          </span>
                          {(crumb.length > 0 || q.topics.length > 0) && (
                            <span className="mt-0.5 block truncate text-[11.5px] text-ink-faint">
                              {crumb.join(" › ")}
                              {crumb.length > 0 && q.topics.length > 0 && " · "}
                              {q.topics.slice(0, 4).map((t) => `#${t}`).join(" ")}
                            </span>
                          )}
                        </span>
                        <span className="flex shrink-0 items-center gap-1.5">
                          {q.companies.length > 0 && (
                            <span className="hidden max-w-[140px] truncate text-[11px] text-ink-faint sm:inline">
                              {q.companies.join(", ")}
                            </span>
                          )}
                          {q.difficulty && (
                            <Badge tone={DIFFICULTY_TONE[q.difficulty]}>{q.difficulty}</Badge>
                          )}
                          {q.status !== "not_started" && (
                            <Badge tone={STATUS_TONE[q.status]}>{STATUS_LABEL[q.status]}</Badge>
                          )}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
