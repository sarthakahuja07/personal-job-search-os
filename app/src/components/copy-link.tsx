"use client";

import { useState } from "react";

import { cx } from "./ui";

/**
 * Copy a job's posting URL to the clipboard.
 *
 * Copies the *original* posting rather than a link to this app: the reason to copy a job is
 * almost always to paste it to someone — a referral contact, a message, the add-by-link box —
 * and none of those people can open a link into a private single-user tool behind Cloudflare
 * Access.
 *
 * The clipboard API can be blocked (an insecure context, a locked-down browser), so the failure
 * is shown rather than swallowed; a button that silently does nothing is worse than one that
 * admits it.
 */
export function CopyLink({
  url,
  compact = false,
  label = "Copy link",
}: {
  url: string;
  /** Icon-only, for dense rows. */
  compact?: boolean;
  label?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setState("copied");
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 1800);
  }

  const title =
    state === "failed"
      ? "Could not copy — the browser blocked clipboard access"
      : `Copy the posting link${compact ? "" : " to share"}`;

  if (compact) {
    return (
      <button
        type="button"
        onClick={copy}
        title={title}
        aria-label={label}
        className={cx(
          "shrink-0 rounded-control px-1 text-label transition",
          state === "copied"
            ? "text-fresh"
            : state === "failed"
              ? "text-danger"
              : "text-ink-faint hover:text-ink-dim",
        )}
      >
        {state === "copied" ? "✓" : state === "failed" ? "!" : "⧉"}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={title}
      className={cx(
        "inline-flex items-center gap-1 rounded-control border px-2 py-1 text-label font-medium transition",
        state === "copied"
          ? "border-fresh/40 bg-fresh-soft text-fresh"
          : state === "failed"
            ? "border-danger/40 text-danger"
            : "border-line bg-surface-2 text-ink-faint hover:border-line-strong hover:text-ink-dim",
      )}
    >
      {state === "copied" ? "Copied" : state === "failed" ? "Blocked" : label}
    </button>
  );
}
