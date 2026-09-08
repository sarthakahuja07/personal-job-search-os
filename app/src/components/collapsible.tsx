"use client";

import { useState, type ReactNode } from "react";

import { cx } from "./ui";

/**
 * A collapsible section whose header stays fully interactive.
 *
 * Deliberately not `<details>/<summary>`: the company header carries links and a mark-read
 * button, and nesting interactive elements inside a `<summary>` breaks both keyboard activation
 * and the click targets. Only the chevron toggles; everything else in the header behaves
 * normally.
 *
 * `header` and `children` arrive as props rather than being rendered here, which keeps the job
 * cards themselves server-rendered — this component adds interactivity without dragging the
 * whole list into the client bundle.
 */
export function Collapsible({
  header,
  children,
  defaultOpen = true,
  label,
}: {
  header: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  /** Announced to screen readers, e.g. the company name. */
  label: string;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <>
      <div className="flex items-start gap-1">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={`${open ? "Collapse" : "Expand"} ${label}`}
          className="mt-2.5 shrink-0 rounded px-1 py-0.5 text-ink-faint transition hover:bg-surface-3 hover:text-ink-dim"
        >
          <span
            className={cx(
              "inline-block text-[10px] leading-none transition-transform",
              open ? "rotate-90" : "rotate-0",
            )}
            aria-hidden
          >
            ▶
          </span>
        </button>
        <div className="min-w-0 flex-1">{header}</div>
      </div>
      {open && children}
    </>
  );
}
