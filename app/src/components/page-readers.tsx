import { Card } from "./ui";

/**
 * A page that is a book.
 *
 * Handed to the browser's own PDF viewer rather than pdf.js: every browser this runs in has a
 * competent reader with search, zoom and a page index, and shipping one would add about a
 * megabyte to reproduce it slightly worse.
 */
export function BookReader({ file, title }: { file: string; title: string }) {
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-label text-ink-faint">
          Your own copy, served only from this deployment.
        </p>
        <div className="flex items-center gap-2">
          <a
            href={file}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-control border border-line-strong bg-accent-soft px-2.5 py-1 text-meta text-ink transition hover:border-line-strong"
          >
            Open in new tab ↗
          </a>
          <a
            href={file}
            download
            className="rounded-control border border-line bg-surface-2 px-2.5 py-1 text-meta text-ink-dim transition hover:border-line-strong hover:text-ink"
          >
            Download
          </a>
        </div>
      </div>

      {/*
        An <iframe> rather than an <object>. Both ask Chrome's built-in viewer to render the
        file, but <object> is the fussier of the two -- it silently swaps in its fallback on
        anything it dislikes about the response, which looks identical to the file being
        absent and tells you nothing about which it was. An iframe either shows the PDF or
        shows an error the browser wrote, and the escape hatch above covers the rest.
      */}
      <iframe
        src={file}
        title={title}
        className="h-[calc(100dvh-15rem)] min-h-[30rem] w-full rounded-card border border-line bg-surface-2"
      />

      <Card className="mt-2 px-4 py-2.5 text-meta leading-relaxed text-ink-faint">
        Blank? Open it in a new tab with the button above — some browsers refuse to render a
        PDF inside a frame, and it will always work as its own page. If the new tab also fails,
        the file is missing: save your copy as{" "}
        <code className="rounded-control border border-line bg-surface-2 px-1 py-0.5 font-mono text-label text-ink">
          app/public{file}
        </code>{" "}
        and redeploy.
      </Card>
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
        <p className="truncate text-label text-ink-faint">{url}</p>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 rounded-control border border-line-strong bg-accent-soft px-2.5 py-1 text-meta text-ink transition hover:border-line-strong"
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
      <p className="mt-2 text-label text-ink-faint">
        If this stays blank, the site is either down or refusing to be embedded. Use the button
        above.
      </p>
    </div>
  );
}
