"use client";

import { useTransition } from "react";

import { setDifficulty, setFrequency } from "@/app/prep/actions";
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
              "rounded-md border px-2.5 py-1 text-[12px] capitalize transition disabled:opacity-60",
              difficulty === l
                ? TONE[l]
                : "border-line bg-surface-2 text-ink-faint hover:border-line-strong hover:text-ink",
            )}
          >
            {l}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1.5">
        <span className="text-[11px] text-ink-faint">Asked</span>
        <div className="flex items-center gap-0.5">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              disabled={pending}
              onClick={() => startTransition(() => setFrequency(id, frequency === n ? 0 : n, path))}
              aria-label={`Asked ${n} out of 5`}
              title={`${n}/5 — ${
                ["rare", "occasional", "common", "frequent", "near-certain"][n - 1]
              }`}
              className={cx(
                "h-4 w-2.5 rounded-sm transition disabled:opacity-60",
                n <= frequency ? "bg-accent" : "bg-surface-3 hover:bg-line-strong",
              )}
            />
          ))}
        </div>
        <span className="tnum text-[11px] text-ink-faint">{frequency}/5</span>
      </div>
    </div>
  );
}
