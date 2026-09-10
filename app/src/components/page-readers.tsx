import { Card, EmptyState } from "./ui";

/**
 * A page that is a book.
 *
 * Rendered in <object> rather than pdf.js: every browser this runs in has a competent PDF
 * reader with search, zoom and a page index, and shipping one would add about a megabyte to
 * reproduce it slightly worse. The fallback inside <object> is what shows when the file is
 * missing -- the browser's own broken-plugin box explains nothing.
 */
export function BookReader({ file, title }: { file: string; title: string }) {
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11.5px] text-ink-faint">
          Your own copy, served only from this deployment.
        </p>
        <div className="flex items-center gap-2">
          <a
            href={file}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md border border-accent bg-accent-soft px-2.5 py-1 text-[12px] text-accent-ink transition hover:border-accent-strong"
          >
            Open in new tab ↗
          </a>
          <a
            href={file}
            download
            className="rounded-md border border-line bg-surface-2 px-2.5 py-1 text-[12px] text-ink-dim transition hover:border-line-strong hover:text-ink"
          >
            Download
          </a>
        </div>
      </div>

      <object
        data={file}
        type="application/pdf"
        className="h-[calc(100dvh-15rem)] min-h-[30rem] w-full rounded-card border border-line bg-surface-2"
        aria-label={title}
      >
        <div className="p-6">
          <EmptyState
            title="The PDF is not here"
            body="This page renders a file you provide; it is not bundled with the app."
          />
          <Card className="mx-auto mt-4 max-w-lg px-4 py-3 text-[12.5px] leading-relaxed text-ink-dim">
            Save your copy as{" "}
            <code className="rounded border border-line bg-surface-2 px-1 py-0.5 font-mono text-[11.5px] text-ink">
              app/public{file}
            </code>{" "}
            and redeploy.
          </Card>
        </div>
      </object>
    </div>
  );
}

/**
 * A page that is somebody else's site.
 *
 * Framing only works where the site permits it. GitHub, for one, sends `X-Frame-Options: deny`
 * and can never be embedded, which is why repositories are rendered natively instead. The
 * escape hatch above the frame is not decoration: a site that refuses to frame, or is simply
 * down, produces a blank rectangle with no explanation.
 */
export function SiteEmbed({ url, title }: { url: string; title: string }) {
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="truncate text-[11.5px] text-ink-faint">{url}</p>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 rounded-md border border-accent bg-accent-soft px-2.5 py-1 text-[12px] text-accent-ink transition hover:border-accent-strong"
        >
          Open in new tab ↗
        </a>
      </div>
      <iframe
        src={url}
        title={title}
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
        className="h-[calc(100dvh-15rem)] min-h-[30rem] w-full rounded-card border border-line bg-surface"
      />
      <p className="mt-2 text-[11px] text-ink-faint">
        If this stays blank, the site is either down or refusing to be embedded. Use the button
        above.
      </p>
    </div>
  );
}
