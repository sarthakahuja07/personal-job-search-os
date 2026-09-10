import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * A prep page's body, rendered.
 *
 * Notion exports Markdown, so Markdown is what these pages store: it survives being read in a
 * terminal, diffed, and pasted back into Notion, which no proprietary block format would. GFM is
 * on because Notion leans on tables and task lists heavily, and a table rendered as a wall of
 * pipes is worse than no table.
 *
 * Styles are written out per element rather than pulled from a typography plugin: the app has a
 * small design-token vocabulary and one more dependency to restate it in would be a poor trade.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="text-body leading-relaxed text-ink-dim">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: (p) => <h1 className="mb-3 mt-6 text-title font-semibold text-ink" {...p} />,
          h2: (p) => <h2 className="mb-2 mt-6 text-section font-semibold text-ink" {...p} />,
          h3: (p) => <h3 className="mb-1.5 mt-5 text-section font-semibold text-ink" {...p} />,
          h4: (p) => <h4 className="mb-1.5 mt-4 text-body font-semibold text-ink" {...p} />,
          p: (p) => <p className="my-2.5" {...p} />,
          ul: (p) => <ul className="my-2.5 list-disc space-y-1 pl-5" {...p} />,
          ol: (p) => <ol className="my-2.5 list-decimal space-y-1 pl-5" {...p} />,
          li: (p) => <li className="pl-0.5" {...p} />,
          strong: (p) => <strong className="font-semibold text-ink" {...p} />,
          em: (p) => <em className="italic" {...p} />,
          hr: () => <hr className="my-6 border-line" />,
          blockquote: (p) => (
            <blockquote
              className="my-3 border-l-2 border-line-strong pl-3.5 text-ink-faint"
              {...p}
            />
          ),
          a: (p) => (
            <a
              className="text-ink underline-offset-2 hover:underline"
              target="_blank"
              rel="noopener noreferrer"
              {...p}
            />
          ),
          code: ({ className, children, ...rest }) => {
            // react-markdown gives fenced blocks a language class and inline code none, which is
            // the only reliable way to tell them apart here.
            const fenced = /language-/.test(className ?? "");
            if (fenced) {
              return (
                <code
                  className="block font-mono text-meta leading-relaxed text-ink-dim"
                  {...rest}
                >
                  {children}
                </code>
              );
            }
            return (
              <code
                className="rounded-control border border-line bg-surface-2 px-1 py-0.5 font-mono text-meta text-ink"
                {...rest}
              >
                {children}
              </code>
            );
          },
          pre: (p) => (
            // Wide code scrolls inside its own box; the page itself must never scroll sideways.
            <pre
              className="my-3 overflow-x-auto rounded-card border border-line bg-surface-2 px-3.5 py-3"
              {...p}
            />
          ),
          table: (p) => (
            <div className="my-3 overflow-x-auto rounded-card border border-line">
              <table className="w-full border-collapse text-meta" {...p} />
            </div>
          ),
          thead: (p) => <thead className="bg-surface-2" {...p} />,
          th: (p) => (
            <th
              className="border-b border-line px-3 py-2 text-left font-medium text-ink"
              {...p}
            />
          ),
          td: (p) => <td className="border-b border-line px-3 py-2 align-top" {...p} />,
          img: (p) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="my-3 max-w-full rounded-card border border-line" alt="" {...p} />
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
