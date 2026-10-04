"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { formatClock, type AnswerShape } from "@/server/domain/behavioral";
import { AnswerBody } from "./behavioral";
import { cx } from "./ui";

export type RehearseCard = {
  id: string;
  /** What you are asked, e.g. "Why Confluent?" or "Walk me through: Lineage Storage Redesign". */
  prompt: string;
  /** "projects", or a theme folder's slug. */
  group: string;
  groupTitle: string;
  url: string;
  shape: AnswerShape;
  /** How long a good answer runs: the written answer's speaking time, or 90s for a pitch. */
  targetSeconds: number;
  /** For a question drawing on a project, that project's title. */
  story: string | null;
};

function shuffleIds(ids: string[]): string[] {
  const a = [...ids];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Time spent on the current card, against its target. Mounted with the card as its `key`, so
 * moving to another card starts it from zero with no reset logic of its own.
 */
function Clock({ targetSeconds }: { targetSeconds: number }) {
  const [start, setStart] = useState(() => Date.now());
  const [now, setNow] = useState(start);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);

  const restart = useCallback(() => {
    const t = Date.now();
    setStart(t);
    setNow(t);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || e.key !== "r") return;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      restart();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [restart]);

  const elapsed = Math.max(0, (now - start) / 1000);
  const over = elapsed / targetSeconds;
  const tone = over > 1.5 ? "text-danger" : over > 1 ? "text-warn" : "text-ink";

  return (
    <div className="text-right">
      <p className={cx("tnum text-[22px] font-semibold leading-none", tone)} aria-label="Time speaking">
        {formatClock(elapsed)}
      </p>
      <p className="tnum mt-1 text-[11.5px] text-ink-faint">aim for ~{formatClock(targetSeconds)}</p>
      <button
        type="button"
        onClick={restart}
        className="mt-1 text-[11.5px] text-ink-faint underline-offset-2 transition hover:text-ink hover:underline"
      >
        Restart clock
      </button>
    </div>
  );
}

/**
 * Behavioral rehearsal: one question at a time, answered out loud against a clock, then checked
 * against what you wrote.
 *
 * Not the spaced-repetition decks DSA and system design use. A story is not something you either
 * know or do not: the failure mode is telling it in four minutes when it should take two, or
 * forgetting the result. So the tools here are the prompt, a running clock with the target
 * beside it, and the written answer held back until you have said yours.
 */
export function BehavioralRehearse({
  cards,
  groups,
  initialFocus,
}: {
  cards: RehearseCard[];
  groups: { slug: string; title: string }[];
  initialFocus: string;
}) {
  const [focus, setFocus] = useState(
    groups.some((g) => g.slug === initialFocus) ? initialFocus : "all",
  );
  const [shuffled, setShuffled] = useState<string[] | null>(null);
  const [position, setPosition] = useState(0);
  const [revealed, setRevealed] = useState(false);

  const pool = useMemo(
    () => (focus === "all" ? cards : cards.filter((c) => c.group === focus)),
    [cards, focus],
  );
  const deck = useMemo(() => {
    if (!shuffled) return pool;
    const byId = new Map(pool.map((c) => [c.id, c]));
    return shuffled.map((id) => byId.get(id)).filter((c): c is RehearseCard => Boolean(c));
  }, [pool, shuffled]);

  const card = deck[Math.min(position, deck.length - 1)];

  const go = useCallback(
    (delta: number) => {
      setPosition((p) => Math.min(Math.max(0, p + delta), Math.max(0, deck.length - 1)));
      setRevealed(false);
    },
    [deck.length],
  );

  const pickFocus = (slug: string) => {
    setFocus(slug);
    setPosition(0);
    setRevealed(false);
    if (shuffled) {
      const next = slug === "all" ? cards : cards.filter((c) => c.group === slug);
      setShuffled(shuffleIds(next.map((c) => c.id)));
    }
  };

  // The focus lives in ?focus= so a link from a project page opens on the pitches.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (focus === "all") url.searchParams.delete("focus");
    else url.searchParams.set("focus", focus);
    window.history.replaceState(window.history.state, "", url);
  }, [focus]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      // A focused button already answers Space and Enter itself; handling them here as well
      // would fire twice.
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(el.tagName))) {
        if (e.key === " " || e.key === "Enter") return;
      }
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        setRevealed((r) => !r);
      } else if (e.key === "ArrowRight" || e.key === "j") {
        go(1);
      } else if (e.key === "ArrowLeft" || e.key === "k") {
        go(-1);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [go]);

  const chip = (active: boolean) =>
    cx(
      "shrink-0 rounded-md border px-2.5 py-1 text-[12.5px] transition",
      active
        ? "border-accent bg-accent-soft text-accent-ink"
        : "border-line bg-surface-2 text-ink-dim hover:border-line-strong hover:text-ink",
    );

  const count = (slug: string) =>
    slug === "all" ? cards.length : cards.filter((c) => c.group === slug).length;

  return (
    <div>
      <div
        role="group"
        aria-label="Which questions"
        className="-mx-1 mb-4 flex gap-1.5 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:overflow-visible"
      >
        {[{ slug: "all", title: "Everything" }, ...groups].map((g) => (
          <button
            key={g.slug}
            type="button"
            aria-pressed={focus === g.slug}
            onClick={() => pickFocus(g.slug)}
            className={chip(focus === g.slug)}
          >
            {g.title}
            <span className="tnum ml-1.5 text-ink-faint">{count(g.slug)}</span>
          </button>
        ))}
      </div>

      {!card ? (
        <p className="rounded-card border border-dashed border-line px-6 py-10 text-center text-[14px] text-ink-dim">
          Nothing to rehearse here yet.
        </p>
      ) : (
        <>
          <div className="mb-3 flex items-center gap-3">
            <div
              className="h-1 flex-1 overflow-hidden rounded-full bg-surface-3"
              role="progressbar"
              aria-label="Position in this set"
              aria-valuemin={1}
              aria-valuemax={deck.length}
              aria-valuenow={position + 1}
            >
              <div
                className="h-full rounded-full bg-accent transition-all"
                style={{ width: `${((position + 1) / deck.length) * 100}%` }}
              />
            </div>
            <span className="tnum text-[12px] text-ink-faint">
              {position + 1} / {deck.length}
            </span>
            <button
              type="button"
              aria-pressed={Boolean(shuffled)}
              onClick={() => {
                setShuffled(shuffled ? null : shuffleIds(pool.map((c) => c.id)));
                setPosition(0);
                setRevealed(false);
              }}
              className={chip(Boolean(shuffled))}
            >
              Shuffle
            </button>
          </div>

          <article className="rounded-card border border-line bg-surface">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
              <div className="min-w-0 flex-1" aria-live="polite">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
                  {card.groupTitle}
                  {card.story && <span className="normal-case tracking-normal"> · {card.story}</span>}
                </p>
                <h2 className="mt-1.5 text-[20px] font-semibold leading-snug text-ink sm:text-[22px]">
                  {card.prompt}
                </h2>
              </div>
              <Clock key={`${card.id}:${position}`} targetSeconds={card.targetSeconds} />
            </div>

            <div className="px-5 py-5">
              {revealed ? (
                <>
                  <AnswerBody shape={card.shape} />
                  <Link
                    href={card.url}
                    className="mt-5 inline-block text-[12.5px] text-accent-ink underline-offset-2 hover:underline"
                  >
                    Open the full page →
                  </Link>
                </>
              ) : (
                <div className="py-6 text-center">
                  <p className="mx-auto max-w-sm text-[13.5px] text-ink-dim">
                    Answer out loud first. Then check what you said against what you wrote.
                  </p>
                  <button
                    type="button"
                    onClick={() => setRevealed(true)}
                    className="mt-4 rounded-md bg-accent px-4 py-2 text-[14px] font-medium text-canvas transition hover:brightness-110"
                  >
                    Show my answer
                  </button>
                </div>
              )}
            </div>
          </article>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => go(-1)}
              disabled={position === 0}
              className="rounded-card border border-line bg-surface-2 px-4 py-2.5 text-[13.5px] text-ink-dim transition hover:border-line-strong hover:text-ink disabled:opacity-40"
            >
              ← Previous
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              disabled={position >= deck.length - 1}
              className="rounded-card border border-line bg-surface-2 px-4 py-2.5 text-[13.5px] text-ink transition hover:border-line-strong disabled:opacity-40"
            >
              Next →
            </button>
          </div>
          <p className="mt-3 hidden text-center text-[11.5px] text-ink-faint sm:block">
            <kbd className="rounded border border-line px-1">Space</kbd> show / hide ·{" "}
            <kbd className="rounded border border-line px-1">←</kbd>{" "}
            <kbd className="rounded border border-line px-1">→</kbd> previous / next ·{" "}
            <kbd className="rounded border border-line px-1">R</kbd> restart clock
          </p>
        </>
      )}
    </div>
  );
}
