"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { cx, inputStyles } from "@/components/ui";

export type CompanyOption = { id: string; name: string; jobCount: number };

/**
 * One box that searches jobs and jumps to companies.
 *
 * Typing a company name used to mean either scrolling the board or knowing the company's id for
 * the URL. Matching companies now surface as you type and jump straight to that company's
 * openings, while the same box still free-text searches titles and locations — a second control
 * for "which company" would be one more thing to learn for the same intent.
 */
export function CompanySearch({
  companies,
  initialQuery,
  hidden,
}: {
  companies: CompanyOption[];
  initialQuery: string;
  /** Filters to preserve when submitting a free-text search. */
  hidden: Record<string, string>;
}) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return companies.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 6);
  }, [companies, query]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function go(company: CompanyOption) {
    setOpen(false);
    setQuery("");
    router.push(`/jobs?company=${company.id}`);
  }

  return (
    <div ref={boxRef} className="relative max-w-xs flex-1">
      <form method="get" onSubmit={() => setOpen(false)}>
        {Object.entries(hidden).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <input
          name="q"
          value={query}
          autoComplete="off"
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (!open || matches.length === 0) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => (i + 1) % matches.length);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => (i - 1 + matches.length) % matches.length);
            } else if (e.key === "Enter" && matches[active]) {
              // Enter on a highlighted company jumps to it; otherwise the form submits and
              // performs the ordinary text search.
              e.preventDefault();
              go(matches[active]);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          placeholder="Search titles, or type a company…"
          className={cx(inputStyles, "w-full")}
        />
      </form>

      {open && matches.length > 0 && (
        <ul className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-md border border-line bg-surface shadow-lg">
          {matches.map((c, i) => (
            <li key={c.id}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => go(c)}
                className={cx(
                  "flex w-full items-center justify-between gap-3 px-2.5 py-1.5 text-left text-[13px] transition",
                  i === active ? "bg-accent-soft text-accent-ink" : "text-ink-dim hover:text-ink",
                )}
              >
                <span className="truncate">{c.name}</span>
                <span className="tnum shrink-0 text-[11px] text-ink-faint">
                  {c.jobCount} open
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
