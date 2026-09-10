import { cx } from "./ui";

/**
 * How often a question is asked, 0-100.
 *
 * Banded rather than a gradient: a number you glance at in a sidebar has to be legible at a
 * glance, and five colours would need a legend. Green is worth preparing first, amber is worth
 * knowing, grey is background.
 */
export function scoreTone(score: number): string {
  if (score >= 80) return "text-fresh";
  if (score >= 60) return "text-warn";
  if (score >= 30) return "text-ink-dim";
  return "text-ink-faint";
}

export function scoreDot(score: number): string {
  if (score >= 80) return "bg-fresh";
  if (score >= 60) return "bg-warn";
  if (score >= 30) return "bg-line-strong";
  return "bg-surface-3";
}

/** The compact form used in the tree, where width is scarce. */
export function ScoreBadge({ score, className }: { score: number; className?: string }) {
  if (!score) return null;
  return (
    <span
      className={cx("tnum shrink-0 text-label font-medium tabular-nums", scoreTone(score), className)}
      title={`Asked ${score}/100 in SDE-2 interviews`}
    >
      {score}
    </span>
  );
}
