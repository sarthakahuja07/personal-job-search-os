"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { TocEntry } from "@/server/domain/behavioral";
import { cx } from "./ui";

/**
 * Which section is being read: the last heading to have scrolled past the top third of the
 * viewport. Measured on scroll rather than with an IntersectionObserver, because sections here
 * are long -- several screens of prose with no heading in view -- and an observer only reports
 * headings entering and leaving, which leaves nothing highlighted mid-section.
 */
function useActiveHeading(ids: string[]): string | null {
  const [active, setActive] = useState<string | null>(ids[0] ?? null);

  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const line = window.innerHeight / 3;
      let current: string | null = ids[0] ?? null;
      for (const id of ids) {
        const el = document.getElementById(id);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= line) current = id;
        else break;
      }
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [ids]);

  return active;
}

function Entries({
  entries,
  active,
  onPick,
}: {
  entries: TocEntry[];
  active: string | null;
  onPick?: () => void;
}) {
  return (
    <ol className="space-y-px">
      {entries.map((e) => {
        const on = e.id === active;
        return (
          <li key={e.id}>
            <a
              href={`#${e.id}`}
              onClick={onPick}
              aria-current={on ? "location" : undefined}
              className={cx(
                "block border-l-2 py-1 pl-3 pr-1 text-[12.5px] leading-snug transition",
                on
                  ? "border-accent font-medium text-ink"
                  : "border-line text-ink-faint hover:border-line-strong hover:text-ink-dim",
              )}
            >
              {e.title}
            </a>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Contents for a long document: `rail` is the sticky column beside it on wide screens, `inline`
 * the collapsible list above it on narrow ones -- each hides itself at the other's widths. The
 * deep dives run to sixty-odd sections, so without this the only way to the "Results" section
 * is scrolling past fifty others.
 */
export function TableOfContents({
  entries,
  variant,
}: {
  entries: TocEntry[];
  variant: "rail" | "inline";
}) {
  // Keyed on the joined ids so a re-render with the same headings keeps the same array, and
  // the scroll listener is not torn down and rebuilt on every render.
  const key = entries.map((e) => e.id).join("\n");
  const ids = useMemo(() => (key ? key.split("\n") : []), [key]);
  const active = useActiveHeading(ids);
  const railRef = useRef<HTMLDivElement>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);

  // Keep the highlighted entry visible in the rail, which scrolls on its own when the list is
  // taller than the screen.
  useEffect(() => {
    const rail = railRef.current;
    if (!rail || !active) return;
    const link = rail.querySelector<HTMLElement>(`a[href="#${CSS.escape(active)}"]`);
    if (!link) return;
    const top = link.offsetTop - rail.offsetTop;
    if (top < rail.scrollTop + 40 || top > rail.scrollTop + rail.clientHeight - 60) {
      rail.scrollTo({ top: top - rail.clientHeight / 3 });
    }
  }, [active]);

  if (entries.length === 0) return null;

  if (variant === "inline") {
    return (
      <details
        ref={detailsRef}
        className="group mb-5 rounded-card border border-line bg-surface xl:hidden"
      >
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-[13px] font-medium text-ink [&::-webkit-details-marker]:hidden">
          <span>
            Contents{" "}
            <span className="tnum font-normal text-ink-faint">· {entries.length} sections</span>
          </span>
          <span aria-hidden className="text-ink-faint transition group-open:rotate-180">
            ▾
          </span>
        </summary>
        <nav aria-label="Contents" className="max-h-[60dvh] overflow-y-auto px-3 pb-3">
          <Entries
            entries={entries}
            active={active}
            onPick={() => detailsRef.current?.removeAttribute("open")}
          />
        </nav>
      </details>
    );
  }

  return (
    <div className="hidden xl:block">
      <div className="sticky top-6">
        <p className="mb-2 pl-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
          Contents
        </p>
        <div ref={railRef} className="relative max-h-[calc(100dvh-7rem)] overflow-y-auto pr-1">
          <nav aria-label="Contents">
            <Entries entries={entries} active={active} />
          </nav>
        </div>
        <a
          href="#top"
          className="mt-3 block pl-3 text-[12px] text-ink-faint transition hover:text-ink"
        >
          ↑ Back to top
        </a>
      </div>
    </div>
  );
}
