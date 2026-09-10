"use client";

import { useState } from "react";

import { cx } from "@/components/ui";

export type Digest = {
  id: string;
  subject: string;
  bodyText: string;
  recipient: string | null;
  notificationCount: number;
  sentAt: Date;
};

/**
 * Every digest email, exactly as it was sent, grouped by the day it went out.
 *
 * The point is to be able to answer "what did the 06:30 email actually say" without going to
 * the inbox — so this shows the real subject and the real body, not a summary of them. Bodies
 * are collapsed because on most days you only want the subject line and the date.
 */
export function DigestList({ digests }: { digests: Digest[] }) {
  const byDay = new Map<string, Digest[]>();
  for (const d of digests) {
    const key = new Date(d.sentAt).toLocaleDateString("en-IN", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    const list = byDay.get(key);
    if (list) list.push(d);
    else byDay.set(key, [d]);
  }

  return (
    <div className="space-y-5">
      {[...byDay.entries()].map(([day, items]) => (
        <section key={day}>
          <div className="mb-2 flex items-baseline gap-2">
            <h2 className="text-body font-semibold text-ink">{day}</h2>
            <span className="tnum text-label text-ink-faint">
              {items.length} email{items.length === 1 ? "" : "s"}
            </span>
          </div>
          <ul className="space-y-2">
            {items.map((d) => (
              <DigestRow key={d.id} digest={d} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function DigestRow({ digest }: { digest: Digest }) {
  const [open, setOpen] = useState(false);
  const sent = new Date(digest.sentAt);

  return (
    <li className="rounded-card border border-line bg-surface">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-start gap-3 px-4 py-3 text-left"
      >
        <span
          className={cx(
            "mt-1 inline-block shrink-0 text-label leading-none text-ink-faint transition-transform",
            open ? "rotate-90" : "",
          )}
          aria-hidden
        >
          ▶
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body font-medium text-ink">
            {digest.subject}
          </span>
          <span className="mt-0.5 block text-label text-ink-faint">
            {/* Exact wall-clock time, not "3h ago": the question this answers is which run sent
                it, and 06:32 answers that where "this morning" does not. */}
            {sent.toLocaleTimeString("en-IN", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
              hour12: true,
            })}
            {" · "}
            {sent.toLocaleDateString("en-IN", {
              day: "2-digit",
              month: "short",
              year: "numeric",
            })}
            {" · "}
            <span className="tnum">{digest.notificationCount}</span> job
            {digest.notificationCount === 1 ? "" : "s"}
            {digest.recipient && ` · to ${digest.recipient}`}
          </span>
        </span>
      </button>

      {open && (
        <pre className="overflow-x-auto whitespace-pre-wrap border-t border-line px-4 py-3 text-meta leading-relaxed text-ink-dim">
          {digest.bodyText}
        </pre>
      )}
    </li>
  );
}
