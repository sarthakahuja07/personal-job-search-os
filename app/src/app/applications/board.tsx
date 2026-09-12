"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";

import { CopyLink } from "@/components/copy-link";
import { cx } from "@/components/ui";
import type { ApplicationStatus } from "@/db/schema";
import { isTerminal, STAGES, STAGE_HINT, STAGE_LABEL } from "@/server/domain/applications";
import type { BoardCard } from "@/server/repository/applications-repo";
import { moveCard, removeCard } from "./actions";

/**
 * How far a pointer must travel before a press counts as a drag rather than a tap.
 *
 * Small enough that dragging feels immediate, large enough to survive the few pixels a finger
 * moves while tapping — which is the whole reason a link on a draggable card still works.
 */
const DRAG_THRESHOLD_PX = 6;

/**
 * The pipeline board.
 *
 * Dragging uses Pointer Events rather than HTML5 drag-and-drop. HTML5 DnD does not fire at all
 * on iOS Safari, so on an iPad the board could only be operated through the stage menu — and
 * that menu was hidden behind `group-hover`, which a touch device never triggers. The result was
 * a board that looked draggable, wasn't, and hid its own fallback.
 *
 * The whole card body is the drag surface — a grip handle alone was too small a target on a
 * touch screen. Links on the card still work because a press only becomes a drag after the
 * pointer travels past a threshold; below it, the tap goes through as normal. `touch-action:
 * none` on that surface stops the browser claiming the gesture for scrolling, and the stage
 * menu and Remove sit outside it so they stay ordinary controls.
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
  /** -1, 0 or 1: which way the board should be auto-scrolling during a drag. */
  const edge = useRef(0);
  /**
   * A press that has not moved far enough to count as a drag yet.
   *
   * This is what lets the whole card be a drag target without breaking the links on it: a press
   * is only claimed as a drag once the pointer travels past a threshold, so a tap still opens
   * the company or the role. A grip handle alone was too small to hit on a touch screen.
   */
  const press = useRef<{ id: string; x: number; y: number; dragged: boolean } | null>(null);
  /** Set for one tick after a drag, to swallow the click the release would otherwise fire. */
  const justDragged = useRef(false);

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
    const onMove = (e: PointerEvent) => {
      const p = press.current;
      if (!p) return;

      if (!p.dragged) {
        // Below the threshold this is still a tap in progress; claiming it early would stop
        // links working, and claiming it never would leave the card undraggable.
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_THRESHOLD_PX) return;
        p.dragged = true;
        setDragging(p.id);
      }

      e.preventDefault();
      setOver(stageAt(e.clientX, e.clientY));

      // Seven stages no longer fit on one screen, so the column you are aiming at may not be
      // visible when the drag starts. Near either edge, hand the direction to the scroll loop.
      const el = rootRef.current;
      if (el) {
        const r = el.getBoundingClientRect();
        const EDGE_PX = 72;
        edge.current =
          e.clientX > r.right - EDGE_PX ? 1 : e.clientX < r.left + EDGE_PX ? -1 : 0;
      }
    };

    const onUp = (e: PointerEvent) => {
      const p = press.current;
      press.current = null;
      if (!p?.dragged) return;

      const card = visible.find((c) => c.id === p.id);
      const target = stageAt(e.clientX, e.clientY);
      justDragged.current = true;
      edge.current = 0;
      setDragging(null);
      setOver(null);
      if (card && target) move(card, target);
    };

    const onCancel = () => {
      press.current = null;
      edge.current = 0;
      setDragging(null);
      setOver(null);
    };

    // A drag that finishes over a link would otherwise fire that link's click on release.
    const onClick = (e: MouseEvent) => {
      if (justDragged.current) {
        e.preventDefault();
        e.stopPropagation();
        justDragged.current = false;
      }
    };

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("click", onClick, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  /**
   * Keep scrolling while the pointer rests near an edge.
   *
   * Doing this in `pointermove` alone would only scroll while the finger keeps moving, which is
   * the opposite of what a drag at the edge of the screen wants -- there is nowhere left to move.
   */
  useEffect(() => {
    if (!dragging) return;
    let frame = requestAnimationFrame(function step() {
      const el = rootRef.current;
      if (el && edge.current) el.scrollLeft += edge.current * 14;
      frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [dragging]);

  return (
    /*
      A kanban scrolls sideways; it does not reflow.

      This used to be `sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-7`, which had two problems.
      Seven stages in four columns wrap onto a second row, so the pipeline stopped reading
      left-to-right in the order work actually moves. And at full width inside a 1100px page,
      seven columns are about 135px each -- narrower than the card's own footer, so the stage
      menu and Remove button spilled out of the column, which is the overflow you could see.

      Fixed-width columns and a horizontal scroll fix both, and give phones the interaction they
      expect: one column at a time, swiped. The negative margins let the board scroll edge to
      edge through the page gutter rather than stopping short of it.
    */
    <div
      ref={rootRef}
      className={cx(
        "-mx-5 overflow-x-auto overscroll-x-contain px-5 pb-3 md:-mx-8 md:px-8",
        pending && "opacity-95",
        // While a drag is in flight, stop the page itself from selecting text under the finger.
        dragging && "select-none",
      )}
    >
      <div className="flex snap-x snap-proximity gap-3">
        {STAGES.map((stage) => {
        const inStage = visible.filter((c) => stageOf(c) === stage);
        return (
          <section
            key={stage}
            data-stage={stage}
            className={cx(
              // Wide enough for the card footer (stage menu, copy, Remove) to sit on one line,
              // which is what it could not do in a grid cell.
              "flex w-68 min-h-40 shrink-0 snap-start flex-col rounded-card border transition",
              // The two outcomes sit quieter than the five active stages: they are where work
              // stops, so they should not compete for attention with the columns that need it.
              isTerminal(stage) ? "bg-surface/30" : "bg-surface/60",
              over === stage
                ? "border-accent bg-accent-soft/30"
                : isTerminal(stage)
                  ? "border-line/60"
                  : "border-line",
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
                  {/* The whole body is the drag surface. touch-action:none tells the browser the
                      gesture is ours so an iPad drags instead of scrolling, and select-none stops
                      a long press turning into a text selection — the two things that made this
                      fight back on a tablet. */}
                  <div
                    onPointerDown={(e) => {
                      if (e.pointerType === "mouse" && e.button !== 0) return;
                      press.current = {
                        id: card.id,
                        x: e.clientX,
                        y: e.clientY,
                        dragged: false,
                      };
                    }}
                    className="flex touch-none select-none items-start gap-1.5 px-2 py-2.5 cursor-grab active:cursor-grabbing"
                  >
                    <span
                      aria-hidden
                      className="mt-0.5 shrink-0 px-1 text-[13px] leading-none text-ink-faint"
                    >
                      ⠿
                    </span>

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
                    <span className="flex items-center gap-1.5">
                      {card.jobUrl && <CopyLink url={card.jobUrl} compact />}
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
                    </span>
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
    </div>
  );
}
