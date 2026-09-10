"use client";

import { useState } from "react";

import { Button, Card, cx } from "@/components/ui";

type Result =
  | { ok: true; message: string; runsUrl?: string }
  | { ok: false; message: string };

/**
 * Run the crawl now rather than waiting for the next scheduled one.
 *
 * The crawler is Python in GitHub Actions, so this dispatches that workflow — which crawls every
 * company and then drains the notification outbox, in that order. One button, because a digest
 * of nothing is not worth sending on its own.
 *
 * It reports "queued", never "done": the dispatch API returns no run id, and saying a crawl
 * succeeded when all we know is that it started would be exactly the kind of false success this
 * project spends its effort preventing.
 */
export function RunCrawl() {
  const [result, setResult] = useState<Result | null>(null);
  const [pending, setPending] = useState(false);

  async function run() {
    setPending(true);
    setResult(null);
    try {
      const response = await fetch("/api/crawler/trigger", { method: "POST" });
      const body = (await response.json()) as {
        message?: string;
        runsUrl?: string;
      };
      setResult(
        response.ok
          ? { ok: true, message: body.message ?? "Crawl queued.", runsUrl: body.runsUrl }
          : { ok: false, message: body.message ?? "Could not start the crawl." },
      );
    } catch {
      setResult({ ok: false, message: "Could not reach the app to start the crawl." });
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="mb-6 px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-ink">Run the crawl now</p>
          <p className="mt-0.5 max-w-xl text-[11px] leading-relaxed text-ink-faint">
            Crawls every automated company and then sends the digest of anything genuinely new.
            Runs on its own at 06:30 and 18:30 IST — this is for when you do not want to wait.
            Takes a couple of minutes.
          </p>
        </div>
        <Button type="button" variant="primary" onClick={run} disabled={pending}>
          {pending ? "Starting…" : "Run crawl"}
        </Button>
      </div>

      {result && (
        <p
          className={cx(
            "mt-3 text-[12px] leading-relaxed",
            result.ok ? "text-fresh" : "text-warn",
          )}
        >
          {result.message}
          {result.ok && result.runsUrl && (
            <>
              {" "}
              <a
                href={result.runsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2"
              >
                Watch it run ↗
              </a>
            </>
          )}
        </p>
      )}
    </Card>
  );
}
