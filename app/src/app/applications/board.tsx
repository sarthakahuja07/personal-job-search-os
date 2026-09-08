"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";

import { cx } from "@/components/ui";
import type { ApplicationStatus } from "@/db/schema";
import { STAGES, STAGE_HINT, STAGE_LABEL } from "@/server/domain/applications";
import type { BoardCard } from "@/server/repository/applications-repo";
import { moveCard, removeCard } from "./actions";

/**
 * The pipeline board.
 *
 * Dragging uses Pointer Events rather than HTML5 drag-and-drop. HTML5 DnD does not fire at all
 * on iOS Safari, so on an iPad the board could only be operated through the stage menu — and
 * that menu was hidden behind `group-hover`, which a touch device never triggers. The result was
 * a board that looked draggable, wasn't, and hid its own fallback.
 *
 * Only the grip handle starts a drag, and it sets `touch-action: none` so the browser does not
 * claim the gesture for scrolling. Everything else on the card stays selectable and tappable.
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
  const rootRef = useRef<HTMLDivElement>(null);

  const visible = cards.filter((c) => !removed.has(c.id));
  const stageOf = (card: BoardCard) => optimistic[card.id] ?? card.status;

  function move(card: BoardCard, stage: ApplicationStatus) {
    if (stageOf(card) === stage) return;
    setOptimistic((o) => ({ ...o, [card.id]: stage }));
    startTransition(async () => {
      await moveCard(card.id, card.jobId, card.companyId, stage);
    });
  }

  /** Which column is under this point, by hit-testing the DOM rather than tracking geometry. */
  function stageAt(x: number, y: number): ApplicationStatus | null {
    const el = document.elementFromPoint(x, y);
    const column = el?.closest<HTMLElement>("[data-stage]");
    const stage = column?.dataset.stage;
    return stage && (STAGES as readonly string[]).includes(stage)
      ? (stage as ApplicationStatus)
      : null;
  }

  // Pointer capture is deliberately not used: capturing to the handle stops elementFromPoint
  // from reporting the column underneath, which is exactly what the drop target depends on.
  useEffect(() => {
    if (!dragging) return;

    const card = visible.find((c) => c.id === dragging);
    const onMove = (e: PointerEvent) => {
      e.preventDefault();
      setOver(stageAt(e.clientX, e.clientY));
    };
    const onUp = (e: PointerEvent) => {
      const target = stageAt(e.clientX, e.clientY);
      setDragging(null);
      setOver(null);
      if (card && target) move(card, target);
    };
    const onCancel = () => {
      setDragging(null);
      setOver(null);
    };

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging, visible]);

  return (
    <div
      ref={rootRef}
      className={cx(
        "grid gap-3 md:grid-cols-3 xl:grid-cols-5",
        pending && "opacity-95",
        // While a drag is in flight, stop the page itself from selecting text under the finger.
        dragging && "select-none",
      )}
    >
      {STAGES.map((stage) => {
        const inStage = visible.filter((c) => stageOf(c) === stage);
        return (
          <section
            key={stage}
            data-stage={stage}
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
                  className={cx(
                    "group rounded-md border border-line bg-surface transition",
                    dragging === card.id
                      ? "opacity-40 ring-1 ring-accent"
                      : "hover:border-line-strong",
                  )}
                >
                  <div className="flex items-start gap-1.5 px-2 py-2.5">
                    {/* The only draggable thing on the card. touch-action:none tells the browser
                        this gesture is ours, so an iPad drags instead of scrolling; keeping it
                        off the rest of the card means text and links stay usable. */}
                    <button
                      type="button"
                      aria-label={`Drag ${card.companyName} — ${card.jobTitle}`}
                      onPointerDown={(e) => {
                        if (e.button !== 0 && e.pointerType === "mouse") return;
                        e.preventDefault();
                        setDragging(card.id);
                      }}
                      className="mt-0.5 shrink-0 cursor-grab touch-none select-none rounded px-1 text-[13px] leading-none text-ink-faint transition hover:text-ink-dim active:cursor-grabbing"
                    >
                      ⠿
                    </button>

                    <div className="min-w-0 flex-1">
                      {/* Company first: the board is read company-by-company — that is how a
                          referral is asked and how you scan for who to chase. */}
                      <Link
                        href={`/companies/${card.companyId}`}
                        className="block truncate text-[13px] font-semibold leading-snug text-ink hover:text-accent-ink"
                      >
                        {card.companyName}
                      </Link>
                      <Link
                        href={`/jobs/${card.jobId}`}
                        className="mt-0.5 block text-[12px] leading-snug text-ink-dim hover:text-ink"
                      >
                        {card.jobTitle}
                      </Link>
                      {card.jobLocation && (
                        <p className="mt-0.5 truncate text-[11px] text-ink-faint">
                          {card.jobLocation}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Always visible. Hiding these behind hover made them unreachable on a
                      touch device, which is where the drag was hardest in the first place. */}
                  <div className="flex items-center justify-between gap-2 border-t border-line/60 px-2 py-1.5">
                    <label className="sr-only" htmlFor={`stage-${card.id}`}>
                      Move {card.jobTitle} to stage
                    </label>
                    <select
                      id={`stage-${card.id}`}
                      value={stageOf(card)}
                      onChange={(e) => move(card, e.target.value as ApplicationStatus)}
                      className="rounded border border-line bg-surface-2 px-1.5 py-1 text-[11px] text-ink-dim outline-none focus:border-accent"
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
                      className="rounded px-1 py-0.5 text-[11px] text-ink-faint transition hover:text-danger"
                      aria-label={`Remove ${card.jobTitle} from the pipeline`}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}

              {inStage.length === 0 && (
                <li className="rounded-md border border-dashed border-line px-3 py-4 text-center text-[11px] text-ink-faint">
                  {dragging ? "Drop here" : "Nothing here"}
                </li>
              )}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
