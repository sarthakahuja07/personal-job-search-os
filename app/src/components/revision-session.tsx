"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { loadRevisionCard, rateRevisionCard } from "@/app/prep/revise/actions";
import type { ReviewRating } from "@/db/schema";
import { DISCIPLINE_TITLE } from "@/server/domain/company";
import { DIFFICULTY_TONE } from "@/server/domain/prep";
import { formatInterval, shuffle, type Card as DeckCard } from "@/server/domain/revision";
import type { CardDetail } from "@/server/service/revision";

import { DsaSolution } from "./dsa-solution";
import { Markdown } from "./markdown";
import { SolutionCode } from "./solution-code";
import { Badge, Card, cx, type Tone } from "./ui";

/**
 * An Anki-style revision session over one deck.
 *
 * The queue is the deck in the order the server drew it. "Again" sends a card to the back of the
 * queue, so a card you did not know comes round again before the session ends; every other
 * rating retires it for this session. Progress counts retired cards, which is why it can only
 * ever move forward -- an "again" adds to the queue, not to the done count.
 *
 * Card content is fetched one card ahead, so revealing and advancing never waits on the network.
 */

const RATINGS: { rating: ReviewRating; label: string; tone: Tone; key: string }[] = [
  { rating: "again", label: "Again", tone: "danger", key: "1" },
  { rating: "hard", label: "Hard", tone: "warn", key: "2" },
  { rating: "good", label: "Good", tone: "fresh", key: "3" },
  { rating: "easy", label: "Easy", tone: "accent", key: "4" },
];

const RATING_STYLE: Record<ReviewRating, string> = {
  again: "hover:border-danger hover:text-danger",
  hard: "hover:border-warn hover:text-warn",
  good: "hover:border-fresh hover:text-fresh",
  easy: "hover:border-accent hover:text-accent-ink",
};

const EMPTY_TALLY: Record<ReviewRating, number> = { again: 0, hard: 0, good: 0, easy: 0 };

function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 mt-8 border-b border-line pb-2 text-[19px] font-bold text-ink first:mt-0">
      {children}
    </h2>
  );
}

/** The question side: name and problem statement, never anything that gives the answer away. */
function Front({ card, detail }: { card: DeckCard; detail: CardDetail | undefined }) {
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge>{DISCIPLINE_TITLE[card.discipline]}</Badge>
        {card.difficulty && (
          <Badge tone={DIFFICULTY_TONE[card.difficulty]}>{card.difficulty}</Badge>
        )}
      </div>
      <h1 className="text-[24px] font-semibold tracking-tight text-ink">{card.title}</h1>

      {!detail ? (
        <p className="mt-4 text-[13px] text-ink-faint">Loading…</p>
      ) : (
        <div className="mt-4">
          {detail.prompt && <p className="mb-4 text-[15px] text-ink-dim">{detail.prompt}</p>}
          {detail.content.problemSummary && (
            <>
              <Heading>Problem</Heading>
              <Markdown size="md" tone="ink">{String(detail.content.problemSummary)}</Markdown>
            </>
          )}
          {detail.content.examples && (
            <>
              <Heading>Example</Heading>
              <Markdown size="md" tone="ink">{String(detail.content.examples)}</Markdown>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const ANSWER_FIELDS: { key: string; label: string }[] = [
  { key: "pattern", label: "Pattern" },
  { key: "approach", label: "Approach" },
  { key: "complexity", label: "Complexity" },
  { key: "requirements", label: "Requirements" },
  { key: "architecture", label: "Architecture" },
  { key: "tradeoffs", label: "Trade-offs" },
];

/** The answer side: everything the page holds. */
function Back({ detail }: { detail: CardDetail }) {
  const content = detail.content;
  if (content.problemSummary) {
    return <DsaSolution content={content} codeFiles={detail.codeFiles} hideProblem />;
  }

  const fields = ANSWER_FIELDS.filter((f) => typeof content[f.key] === "string" && content[f.key]);
  const hasAnything =
    Boolean(detail.body) ||
    fields.length > 0 ||
    Boolean(detail.notes) ||
    Boolean(detail.solution) ||
    detail.codeFiles.length > 0;

  return (
    <div>
      {!hasAnything && (
        <p className="text-[13px] text-ink-faint">
          This page has no written answer yet. Open the page to add one.
        </p>
      )}
      {detail.body && <Markdown size="md" tone="ink">{detail.body}</Markdown>}
      {fields.map((f) => (
        <div key={f.key}>
          <Heading>{f.label}</Heading>
          <Markdown size="md" tone="ink">{String(content[f.key])}</Markdown>
        </div>
      ))}
      {detail.notes && (
        <>
          <Heading>Your notes</Heading>
          <Markdown size="md" tone="ink">{detail.notes}</Markdown>
        </>
      )}
      {detail.solution && (
        <>
          <Heading>Your solution</Heading>
          <pre className="overflow-x-auto rounded-card border border-line bg-surface-2 p-3 font-mono text-[12.5px] text-ink">
            {detail.solution}
          </pre>
        </>
      )}
      {detail.codeFiles.length > 0 && (
        <>
          <Heading>Code</Heading>
          {detail.codeFiles.map((file) => (
            <details key={file.id} className="mb-2" open={detail.codeFiles.length === 1}>
              <summary className="cursor-pointer py-1 font-mono text-[12.5px] text-ink-dim hover:text-ink">
                {file.path}
              </summary>
              <div className="mt-2">
                <SolutionCode file={file} />
              </div>
            </details>
          ))}
        </>
      )}
    </div>
  );
}

export function RevisionSession({
  deckTitle,
  mode,
  cards,
}: {
  deckTitle: string;
  mode: "all" | "due";
  cards: DeckCard[];
}) {
  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  const [queue, setQueue] = useState<string[]>(() => cards.map((c) => c.id));
  const [pos, setPos] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [done, setDone] = useState<string[]>([]);
  /** Cards whose latest rating this session was "again": still in the queue, coming back. */
  const [relearning, setRelearning] = useState<string[]>([]);
  const [tally, setTally] = useState(EMPTY_TALLY);
  const [details, setDetails] = useState<Record<string, CardDetail | "error">>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [cardShownAt, setCardShownAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const inFlight = useRef(new Set<string>());

  const total = cards.length;
  const finished = pos >= queue.length;
  const currentId = finished ? null : queue[pos];
  const current = currentId ? byId.get(currentId) : undefined;
  const detail = currentId ? details[currentId] : undefined;

  // The clock only runs while there is a card on screen.
  useEffect(() => {
    if (finished) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [finished]);

  // Fetch the current card and the one after it.
  useEffect(() => {
    for (const id of [queue[pos], queue[pos + 1]]) {
      if (!id || details[id] || inFlight.current.has(id)) continue;
      inFlight.current.add(id);
      loadRevisionCard(id)
        .then((d) => setDetails((prev) => ({ ...prev, [id]: d ?? "error" })))
        .catch(() => setDetails((prev) => ({ ...prev, [id]: "error" })))
        .finally(() => inFlight.current.delete(id));
    }
  }, [queue, pos, details]);

  const advance = useCallback(() => {
    setPos((p) => p + 1);
    setRevealed(false);
    setCardShownAt(Date.now());
    window.scrollTo({ top: 0 });
  }, []);

  const rate = useCallback(
    (rating: ReviewRating) => {
      if (!currentId || !revealed) return;
      rateRevisionCard(currentId, rating).catch(() =>
        setSaveError("A rating could not be saved. The session continues, but check your connection."),
      );
      setTally((t) => ({ ...t, [rating]: t[rating] + 1 }));
      if (rating === "again") {
        setQueue((q) => [...q, currentId]);
        setRelearning((r) => (r.includes(currentId) ? r : [...r, currentId]));
      } else {
        setDone((d) => (d.includes(currentId) ? d : [...d, currentId]));
        setRelearning((r) => r.filter((id) => id !== currentId));
      }
      advance();
    },
    [currentId, revealed, advance],
  );

  /** Put the card at the back without rating it. */
  const skip = useCallback(() => {
    if (!currentId) return;
    setQueue((q) => [...q, currentId]);
    advance();
  }, [currentId, advance]);

  const restart = () => {
    setQueue(shuffle(cards.map((c) => c.id)));
    setPos(0);
    setRevealed(false);
    setDone([]);
    setRelearning([]);
    setTally(EMPTY_TALLY);
    setStartedAt(Date.now());
    setCardShownAt(Date.now());
    setNow(Date.now());
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (!revealed && (e.key === " " || e.key === "Enter")) {
        e.preventDefault();
        setRevealed(true);
        return;
      }
      const hit = RATINGS.find((r) => r.key === e.key);
      if (revealed && hit) {
        e.preventDefault();
        rate(hit.rating);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [revealed, rate]);

  const percent = total === 0 ? 0 : Math.round((done.length / total) * 100);

  const header = (
    <div className="sticky top-0 z-10 -mx-2 mb-6 border-b border-line bg-canvas/95 px-2 pb-3 pt-2 backdrop-blur">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/prep/revise" className="text-[13px] text-ink-dim transition hover:text-ink">
            ← Decks
          </Link>
          <span className="truncate text-[14px] font-medium text-ink">{deckTitle}</span>
          {mode === "due" && <Badge tone="warn">due + new</Badge>}
        </div>
        <div className="tnum flex items-center gap-3 text-[12px] text-ink-faint">
          <span title="Time on this card">card {clock(now - cardShownAt)}</span>
          <span title="Session time">total {clock(now - startedAt)}</span>
        </div>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-3">
        <div
          className="h-full rounded-full bg-accent transition-all duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="tnum mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[12px] text-ink-dim">
        <span>
          <span className="text-ink">{done.length}</span> done ·{" "}
          <span className="text-ink">{total - done.length}</span> left of {total}
          {relearning.length > 0 && (
            <span className="text-danger"> · {relearning.length} coming back</span>
          )}
        </span>
        <span className="flex gap-1.5">
          {RATINGS.map((r) => (
            <Badge key={r.rating} tone={r.tone}>
              {r.label} {tally[r.rating]}
            </Badge>
          ))}
          <span className="ml-1">{percent}%</span>
        </span>
      </div>
    </div>
  );

  if (total === 0) {
    return (
      <div className="max-w-3xl">
        {header}
        <Card className="border-dashed px-8 py-12 text-center">
          <p className="text-[15px] font-medium text-ink">Nothing to revise</p>
          <p className="mt-1.5 text-sm text-ink-dim">
            {mode === "due"
              ? "Every card in this deck is scheduled for later. Revise the whole deck instead, or come back when cards are due."
              : "This deck has no questions yet."}
          </p>
        </Card>
      </div>
    );
  }

  if (finished || !current) {
    const reviewed = Object.values(tally).reduce((a, b) => a + b, 0);
    return (
      <div className="max-w-3xl">
        {header}
        <Card className="px-8 py-10 text-center">
          <p className="text-[20px] font-semibold text-ink">Deck complete</p>
          <p className="mt-1.5 text-sm text-ink-dim">
            {total} cards, {reviewed} reviews in {clock(now - startedAt)}.
          </p>
          <div className="mt-4 flex justify-center gap-2">
            {RATINGS.map((r) => (
              <Badge key={r.rating} tone={r.tone}>
                {r.label} {tally[r.rating]}
              </Badge>
            ))}
          </div>
          <div className="mt-6 flex justify-center gap-2">
            <button
              type="button"
              onClick={restart}
              className="rounded-md bg-accent px-4 py-2 text-[13px] font-medium text-canvas transition hover:brightness-110"
            >
              Reshuffle and go again
            </button>
            <Link
              href="/prep/revise"
              className="rounded-md border border-line bg-surface-2 px-4 py-2 text-[13px] text-ink-dim transition hover:border-line-strong hover:text-ink"
            >
              Choose another deck
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  const loaded = detail && detail !== "error" ? detail : undefined;

  return (
    <div className="max-w-3xl pb-40">
      {header}

      {saveError && (
        <Card className="mb-4 border-danger px-4 py-2.5">
          <p className="text-[12.5px] text-danger">{saveError}</p>
        </Card>
      )}

      <Card className="px-6 py-6">
        <Front card={current} detail={loaded} />
        {detail === "error" && (
          <p className="mt-4 text-[13px] text-danger">This card could not be loaded.</p>
        )}

        {revealed && (
          <div className="mt-8 border-t-2 border-dashed border-line-strong pt-6">
            {loaded ? <Back detail={loaded} /> : <p className="text-ink-faint">Loading…</p>}
          </div>
        )}

        <div className="mt-6 flex items-center justify-between text-[12px]">
          <Link
            href={`/prep/${current.href}`}
            target="_blank"
            className="text-ink-faint transition hover:text-ink"
          >
            Open page ↗
          </Link>
          <button
            type="button"
            onClick={skip}
            className="text-ink-faint transition hover:text-ink"
          >
            Skip for now
          </button>
        </div>
      </Card>

      {/* The answer bar, fixed to the bottom of the viewport as in Anki: the buttons stay in the
          same place whatever the length of the answer, so rating never needs a scroll. */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 backdrop-blur md:left-[228px]">
        <div className="mx-auto flex max-w-3xl items-end justify-center gap-2 px-4 py-3">
          {!revealed ? (
            <button
              type="button"
              onClick={() => setRevealed(true)}
              className="w-full max-w-sm rounded-md bg-accent px-4 py-2.5 text-[14px] font-medium text-canvas transition hover:brightness-110"
            >
              Show answer <span className="ml-1 text-[11px] opacity-70">space</span>
            </button>
          ) : (
            RATINGS.map((r) => (
              <div key={r.rating} className="flex flex-1 flex-col items-center gap-1 sm:flex-none">
                <span className="tnum text-[11px] text-ink-faint">
                  {loaded ? formatInterval(loaded.intervals[r.rating]) : "…"}
                </span>
                <button
                  type="button"
                  onClick={() => rate(r.rating)}
                  className={cx(
                    "w-full rounded-full border border-line bg-surface-2 px-5 py-1.5 text-[13px] text-ink transition sm:w-24",
                    RATING_STYLE[r.rating],
                  )}
                >
                  {r.label}
                </button>
                <span className="text-[10px] text-ink-faint">{r.key}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
