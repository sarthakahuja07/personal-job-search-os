"use client";

import { useState, useTransition } from "react";

import { dismissLead, promoteLead } from "@/app/linkedin/actions";
import { Badge, cx } from "./ui";

export type Lead = {
  id: string;
  linkedinJobId: string;
  companyName: string;
  title: string;
  location: string | null;
  jobUrl: string;
  feed: string;
  discoveredAt: Date;
};

const DAY = 86_400_000;

// Module scope, not the component body: react-hooks/purity rightly rejects Date.now() during
// render, and threading a timestamp down as a prop only moves the same call somewhere else.
function ago(from: Date): string {
  const days = Math.floor((Date.now() - from.getTime()) / DAY);
  if (days <= 0) return "today";
  if (days === 1) return "1d ago";
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/**
 * One employer that is not on the board, with everything LinkedIn has shown for them.
 *
 * Grouped by company rather than listed flat because the decision is about the company, not the
 * posting: adding Oracle is one judgement that brings its five openings with it. A flat list
 * would ask the same question five times.
 */
export function LeadGroup({
  companyName,
  leads,
}: {
  companyName: string;
  leads: Lead[];
}) {
  const [pending, startTransition] = useTransition();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [added, setAdded] = useState(false);

  const visible = leads.filter((l) => !hidden.has(l.id));
  if (visible.length === 0 || added) return null;

  return (
    <div className="rounded-card border border-line bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-line px-3.5 py-2.5">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium text-ink">{companyName}</div>
          <div className="text-[11px] text-ink-faint">
            {visible.length} opening{visible.length === 1 ? "" : "s"} · not on your board
          </div>
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const r = await promoteLead(companyName);
              if (r.ok) setAdded(true);
            })
          }
          className={cx(
            "shrink-0 rounded-md border px-2.5 py-1 text-[12px] transition",
            pending
              ? "border-line bg-surface-2 text-ink-faint"
              : "border-accent bg-accent-soft text-accent-ink hover:border-accent-strong",
          )}
        >
          {pending ? "Adding…" : "Add company"}
        </button>
      </div>

      <ul className="divide-y divide-line">
        {visible.map((lead) => (
          <li key={lead.id} className="flex items-start gap-3 px-3.5 py-2.5">
            <div className="min-w-0 flex-1">
              <a
                href={lead.jobUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[13px] text-ink underline-offset-2 hover:underline"
              >
                {lead.title}
              </a>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-ink-faint">
                {lead.location && <span>{lead.location}</span>}
                <span>·</span>
                <span>{ago(lead.discoveredAt)}</span>
                {lead.feed === "recommended" && <Badge tone="neutral">Picked for you</Badge>}
              </div>
            </div>
            <button
              type="button"
              title="Hide this posting"
              onClick={() =>
                startTransition(async () => {
                  setHidden((h) => new Set(h).add(lead.id));
                  await dismissLead(lead.id);
                })
              }
              className="shrink-0 rounded px-1.5 text-[15px] leading-none text-ink-faint transition hover:text-ink"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
