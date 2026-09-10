import Link from "next/link";
import { notFound } from "next/navigation";

import { Card, EmptyState, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * The two Alex Xu volumes, read in the app.
 *
 * The PDFs are not in this repository and will not be: they are paid books, and the only
 * legitimate copy is one Sarthak bought. Dropping his own file into `app/public/books/`
 * publishes it to his own private, Access-protected deployment, which is the same as opening
 * it on his laptop.
 *
 * Rendered in an <object> rather than a JS PDF viewer. Every browser this app is used in has
 * a competent built-in reader with search, zoom and a page index; shipping pdf.js would add
 * about a megabyte to reproduce it slightly worse.
 */

const BOOKS: Record<string, { title: string; subtitle: string; file: string }> = {
  "system-design-interview-vol-1": {
    title: "System Design Interview — Volume 1",
    subtitle: "Alex Xu. The sixteen chapters most interviews are drawn from.",
    file: "/books/system-design-interview-vol-1.pdf",
  },
  "system-design-interview-vol-2": {
    title: "System Design Interview — Volume 2",
    subtitle: "Alex Xu and Sahn Lam. Proximity, payments, hotels, metrics, ads.",
    file: "/books/system-design-interview-vol-2.pdf",
  },
};

export function generateStaticParams() {
  return Object.keys(BOOKS).map((slug) => ({ slug }));
}

export default async function BookPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const book = BOOKS[slug];
  if (!book) notFound();

  const other = Object.entries(BOOKS).find(([s]) => s !== slug);

  return (
    <div>
      <PageHeader
        title={book.title}
        subtitle={book.subtitle}
        actions={
          other ? (
            <Link
              href={`/prep/books/${other[0]}`}
              className="text-[13px] text-ink-dim transition hover:text-ink"
            >
              {other[1].title.replace("System Design Interview — ", "")} →
            </Link>
          ) : null
        }
      />

      {/* If the file is absent the browser renders its own broken-plugin box, which explains
          nothing. The fallback inside <object> is what shows instead. */}
      <object
        data={book.file}
        type="application/pdf"
        className="h-[calc(100dvh-13rem)] w-full rounded-card border border-line bg-surface-2"
        aria-label={book.title}
      >
        <div className="p-6">
          <EmptyState
            title="The PDF is not here yet"
            body={
              "This page renders a file you provide. It is not bundled: these are paid books, " +
              "and the only legitimate copy is one you bought."
            }
          />
          <Card className="mx-auto mt-4 max-w-lg px-4 py-3 text-[12.5px] leading-relaxed text-ink-dim">
            <p className="mb-1.5 font-medium text-ink">To add it</p>
            <p>
              Save your copy as{" "}
              <code className="rounded border border-line bg-surface-2 px-1 py-0.5 font-mono text-[11.5px] text-ink">
                app/public{book.file}
              </code>{" "}
              and redeploy. It is served only from your own Access-protected deployment.
            </p>
          </Card>
        </div>
      </object>

      <p className="mt-2 text-[11px] text-ink-faint">
        Trouble scrolling inside the reader?{" "}
        <a
          href={book.file}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent-ink hover:underline"
        >
          Open it in a new tab
        </a>
        .
      </p>
    </div>
  );
}
