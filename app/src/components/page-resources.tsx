"use client";

import { useState, useTransition } from "react";

import { addPageResource, removePageResource } from "@/app/prep/actions";
import { cx } from "./ui";

export type Resource = {
  id: string;
  kind: string;
  url: string;
  title: string;
  source: string | null;
  videoId: string | null;
};

/**
 * Watch and read material, pinned to the top of a page.
 *
 * At the top because it is what you reach for *before* writing an answer, not after. The
 * previous layout put everything below the document, which meant scrolling past your own notes
 * to find the video that explains them.
 *
 * Videos play in place. They load as a thumbnail and only become an iframe when clicked --
 * a page with six embeds would otherwise pull six YouTube players on every visit, and none of
 * them are wanted until one is.
 */
export function PageResources({
  prepItemId,
  path,
  resources,
}: {
  prepItemId: string;
  path: string;
  resources: Resource[];
}) {
  const [pending, startTransition] = useTransition();
  const [playing, setPlaying] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [removed, setRemoved] = useState<Set<string>>(new Set());

  const live = resources.filter((r) => !removed.has(r.id));
  const videos = live.filter((r) => r.kind === "video" && r.videoId);
  const links = live.filter((r) => r.kind !== "video" || !r.videoId);

  const drop = (id: string) =>
    startTransition(async () => {
      setRemoved((prev) => new Set(prev).add(id));
      await removePageResource(id, path);
    });

  return (
    <section className="mb-6">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-label font-semibold uppercase tracking-[0.1em] text-ink-faint">
          Watch &amp; read
          {live.length > 0 && <span className="ml-1.5 text-ink-faint">· {live.length}</span>}
        </h2>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="text-meta text-ink-dim transition hover:text-ink"
        >
          {adding ? "Cancel" : "+ Add link"}
        </button>
      </div>

      {adding && (
        <form
          action={(fd) => {
            startTransition(async () => {
              await addPageResource(fd);
              setAdding(false);
            });
          }}
          className="mb-3 flex flex-wrap gap-2 rounded-card border border-line bg-surface-2 p-2.5"
        >
          <input type="hidden" name="prepItemId" value={prepItemId} />
          <input type="hidden" name="path" value={path} />
          <input
            name="url"
            required
            autoFocus
            placeholder="Paste a YouTube or blog link"
            className="min-w-0 flex-1 rounded-control border border-line bg-surface px-2.5 py-1.5 text-body text-ink outline-none focus:border-line-strong"
          />
          <input
            name="title"
            placeholder="Title (optional)"
            className="min-w-0 flex-1 rounded-control border border-line bg-surface px-2.5 py-1.5 text-body text-ink outline-none focus:border-line-strong"
          />
          <button
            type="submit"
            disabled={pending}
            className="rounded-control border border-line-strong bg-accent-soft px-3 py-1.5 text-body text-ink transition hover:border-line-strong disabled:opacity-60"
          >
            Add
          </button>
        </form>
      )}

      {live.length === 0 && !adding && (
        <p className="rounded-card border border-dashed border-line px-3.5 py-3 text-meta text-ink-faint">
          Nothing pinned yet. Paste a YouTube or blog link and it will play or open from here.
        </p>
      )}

      {videos.length > 0 && (
        <div className="mb-2 grid gap-2 sm:grid-cols-2">
          {videos.map((v) => (
            <div
              key={v.id}
              className="group relative overflow-hidden rounded-card border border-line bg-surface"
            >
              <div className="relative aspect-video w-full bg-surface-3">
                {playing === v.id ? (
                  <iframe
                    src={`https://www.youtube-nocookie.com/embed/${v.videoId}?autoplay=1&rel=0`}
                    title={v.title}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
                    allowFullScreen
                    className="absolute inset-0 h-full w-full"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setPlaying(v.id)}
                    aria-label={`Play ${v.title}`}
                    className="absolute inset-0 grid place-items-center"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`}
                      alt=""
                      loading="lazy"
                      className="absolute inset-0 h-full w-full object-cover transition group-hover:opacity-90"
                    />
                    <span className="relative grid size-11 place-items-center rounded-full bg-black/65 text-white transition group-hover:bg-black/80">
                      <svg viewBox="0 0 24 24" className="ml-0.5 size-5" aria-hidden>
                        <path d="M8 5v14l11-7z" fill="currentColor" />
                      </svg>
                    </span>
                  </button>
                )}
              </div>
              <div className="flex items-start justify-between gap-2 px-3 py-2">
                <div className="min-w-0">
                  <a
                    href={v.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block truncate text-meta text-ink underline-offset-2 hover:underline"
                    title={v.title}
                  >
                    {v.title}
                  </a>
                  {v.source && <p className="text-label text-ink-faint">{v.source}</p>}
                </div>
                <RemoveButton onClick={() => drop(v.id)} />
              </div>
            </div>
          ))}
        </div>
      )}

      {links.length > 0 && (
        <ul className="space-y-1.5">
          {links.map((l) => (
            <li
              key={l.id}
              className="group flex items-center justify-between gap-3 rounded-card border border-line bg-surface px-3.5 py-2 transition hover:border-line-strong"
            >
              <a
                href={l.url}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 flex-1"
              >
                <span className="block truncate text-body text-ink">{l.title}</span>
                {l.source && <span className="text-label text-ink-faint">{l.source}</span>}
              </a>
              <RemoveButton onClick={() => drop(l.id)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Remove this link"
      className={cx(
        "shrink-0 rounded-control px-1.5 text-section leading-none text-ink-faint opacity-0 transition",
        "hover:text-ink group-hover:opacity-100 focus:opacity-100",
      )}
    >
      ×
    </button>
  );
}
