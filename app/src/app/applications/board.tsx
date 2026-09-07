"use client";

import { useState, useTransition } from "react";
import Link from "next/link";

import { cx } from "@/components/ui";
import type { ApplicationStatus } from "@/db/schema";
import { STAGES, STAGE_HINT, STAGE_LABEL } from "@/server/domain/applications";
import type { BoardCard } from "@/server/repository/applications-repo";
import { moveCard, removeCard } from "./actions";

/**
 * The pipeline board.
 *
 * Drag and drop with a keyboard-accessible fallback: every card also carries a stage menu, so
 * the board is fully usable without a pointer. Drag alone would make this the one screen in the
 * product that cannot be operated from a keyboard.
 *
 * Moves are optimistic. Waiting for a round trip before the card visibly moves makes dragging
 * feel broken, and the failure mode is benign -- a rejected move simply reverts on refresh.
 */
export function Board({ cards }: { cards: BoardCard[] }) {
  const [pending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useState<Record<string, ApplicationStatus>>({});
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<ApplicationStatus | null>(null);

  const visible = cards.filter((c) => !removed.has(c.id));
  const stageOf = (card: BoardCard) => optimistic[card.id] ?? card.status;

  function move(card: BoardCard, stage: ApplicationStatus) {
    if (stageOf(card) === stage) return;
    setOptimistic((o) => ({ ...o, [card.id]: stage }));
    startTransition(async () => {
      await moveCard(card.id, card.jobId, card.companyId, stage);
    });
  }

  function drop(stage: ApplicationStatus) {
    setOver(null);
    const card = visible.find((c) => c.id === dragging);
    setDragging(null);
    if (card) move(card, stage);
  }

  return (
    <div
      className={cx(
        "grid gap-3 md:grid-cols-3 xl:grid-cols-5",
        pending && "opacity-95",
      )}
    >
      {STAGES.map((stage) => {
        const inStage = visible.filter((c) => stageOf(c) === stage);
        return (
          <section
            key={stage}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(stage);
            }}
            onDragLeave={() => setOver((s) => (s === stage ? null : s))}
            onDrop={() => drop(stage)}
            className={cx(
              "flex min-h-[160px] flex-col rounded-card border bg-surface/60 transition",
              over === stage ? "border-accent bg-accent-soft/30" : "border-line",
            )}
          >
            <header className="border-b border-line px-3 py-2.5">
              <div className="flex items-baseline justify-between">
                <h2 className="text-[13px] font-semibold text-ink">{STAGE_LABEL[stage]}</h2>
                <span className="tnum text-[11px] text-ink-faint">{inStage.length}</span>
              </div>
              <p className="mt-0.5 text-[11px] text-ink-faint">{STAGE_HINT[stage]}</p>
            </header>

            <ul className="flex-1 space-y-2 p-2">
              {inStage.map((card) => (
                <li
                  key={card.id}
                  draggable
                  onDragStart={() => setDragging(card.id)}
                  onDragEnd={() => {
                    setDragging(null);
                    setOver(null);
                  }}
                  className={cx(
                    "group cursor-grab rounded-md border border-line bg-surface px-3 py-2.5 transition active:cursor-grabbing",
                    dragging === card.id ? "opacity-40" : "hover:border-line-strong",
                  )}
                >
                  <Link
                    href={`/jobs/${card.jobId}`}
                    className="block text-[13px] font-medium leading-snug text-ink hover:text-accent-ink"
                  >
                    {card.jobTitle}
                  </Link>
                  <div className="mt-1 flex items-center gap-1.5 text-[11px] text-ink-dim">
                    <span>{card.companyName}</span>
                    {card.jobLocation && (
                      <>
                        <span className="text-ink-faint">·</span>
                        <span className="truncate">{card.jobLocation}</span>
                      </>
                    )}
                  </div>

                  <div className="mt-2 flex items-center justify-between gap-2 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                    <label className="sr-only" htmlFor={`stage-${card.id}`}>
                      Move {card.jobTitle} to stage
                    </label>
                    <select
                      id={`stage-${card.id}`}
                      value={stageOf(card)}
                      onChange={(e) => move(card, e.target.value as ApplicationStatus)}
                      className="rounded border border-line bg-surface-2 px-1.5 py-0.5 text-[11px] text-ink-dim outline-none focus:border-accent"
                    >
                      {STAGES.map((s) => (
                        <option key={s} value={s} className="bg-surface-2">
                          {STAGE_LABEL[s]}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => {
                        setRemoved((r) => new Set(r).add(card.id));
                        startTransition(async () => {
                          await removeCard(card.id);
                        });
                      }}
                      className="text-[11px] text-ink-faint transition hover:text-danger"
                      aria-label={`Remove ${card.jobTitle} from the pipeline`}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}

              {inStage.length === 0 && (
                <li className="rounded-md border border-dashed border-line px-3 py-4 text-center text-[11px] text-ink-faint">
                  Drop here
                </li>
              )}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
