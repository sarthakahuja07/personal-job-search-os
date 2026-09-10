"use client";

import { useState, useTransition } from "react";

import { setDifficulty, setFrequency } from "@/app/prep/actions";
import { scoreTone } from "./score";
import { cx } from "./ui";

const LEVELS = ["easy", "medium", "hard"] as const;

const TONE: Record<string, string> = {
  easy: "border-fresh bg-fresh-soft text-fresh",
  medium: "border-warn bg-warn-soft text-warn",
  hard: "border-danger bg-danger-soft text-danger",
};

/**
 * How hard, and how often asked.
 *
 * Both are single clicks and both are optimistic, because they are revised constantly -- after
 * a mock, after a real interview -- and a judgement that costs a page reload to record is a
 * judgement that quietly stops being recorded.
 *
 * Clicking the level you already have clears it, so "I do not know yet" stays expressible; a
 * control with no way back to empty makes its own default look like an answer.
 */
export function PageGrading({
  id,
  path,
  difficulty,
  frequency,
}: {
  id: string;
  path: string;
  difficulty: string | null;
  frequency: number;
}) {
  const [pending, startTransition] = useTransition();
  const [score, setScore] = useState(frequency);
  const [lastFromServer, setLastFromServer] = useState(frequency);

  // Adjusting state during render rather than in an effect: React documents this exact case --
  // resetting local state when a prop changes -- and doing it in an effect renders twice and
  // trips react-hooks/set-state-in-effect. The `pending` guard is what stops a server value
  // arriving mid-drag and yanking the slider out from under the pointer.
  if (frequency !== lastFromServer && !pending) {
    setLastFromServer(frequency);
    setScore(frequency);
  }

  const commit = () => {
    if (score === frequency) return;
    startTransition(() => setFrequency(id, score, path));
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-1">
        {LEVELS.map((l) => (
          <button
            key={l}
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(() => setDifficulty(id, difficulty === l ? null : l, path))
            }
            title={difficulty === l ? `Clear ${l}` : `Mark ${l}`}
            className={cx(
              "rounded-control border px-2.5 py-1 text-meta capitalize transition disabled:opacity-60",
              difficulty === l
                ? TONE[l]
                : "border-line bg-surface-2 text-ink-faint hover:border-line-strong hover:text-ink",
            )}
          >
            {l}
          </button>
        ))}
      </div>

      <div className="flex min-w-[13rem] flex-1 items-center gap-2">
        <span className="shrink-0 text-label text-ink-faint">Asked</span>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={score}
          disabled={pending}
          onChange={(e) => setScore(Number(e.target.value))}
          // Commit on release rather than on every pixel of the drag: onChange fires
          // continuously and would post a hundred writes for one adjustment.
          onMouseUp={() => commit()}
          onTouchEnd={() => commit()}
          onKeyUp={() => commit()}
          aria-label="How often this is asked, out of 100"
          className="h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-surface-3 accent-accent"
        />
        <span className={cx("tnum w-9 shrink-0 text-right text-meta font-medium", scoreTone(score))}>
          {score}
        </span>
      </div>
    </div>
  );
}
