import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Mermaid } from "./mermaid";
import { cx } from "./ui";

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

/**
 * Drop react-markdown's `node` before the props reach the DOM.
 *
 * Every override below spreads its props onto a real element, and react-markdown hands each one
 * the mdast `node` it came from. React 19 does not warn about an unknown prop -- it renders it --
 * so every heading, paragraph, list item and link in a rendered page carried a literal
 * `node="[object Object]"` attribute. Invalid HTML, and needless weight on pages that are mostly
 * prose.
 */
function dom<T extends { node?: unknown }>(props: T): Omit<T, "node"> {
  const { node, ...rest } = props;
  return rest;
}

export function Markdown({ children }: { children: string }) {
  return (
    <div className="text-[13.5px] leading-relaxed text-ink-dim">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: (p) => <h1 className="mb-3 mt-6 text-[19px] font-semibold text-ink" {...dom(p)} />,
          h2: (p) => <h2 className="mb-2 mt-6 text-[16px] font-semibold text-ink" {...dom(p)} />,
          h3: (p) => <h3 className="mb-1.5 mt-5 text-[14px] font-semibold text-ink" {...dom(p)} />,
          h4: (p) => <h4 className="mb-1.5 mt-4 text-[13px] font-semibold text-ink" {...dom(p)} />,
          p: (p) => <p className="my-2.5" {...dom(p)} />,
          ul: (p) => <ul className="my-2.5 list-disc space-y-1 pl-5" {...dom(p)} />,
          ol: (p) => <ol className="my-2.5 list-decimal space-y-1 pl-5" {...dom(p)} />,
          // A GFM task-list item (`- [x]`) is an <li> directly containing a checkbox <input>;
          // :has() scopes the flex layout and dropped marker to just those items, so an
          // ordinary bullet list (steps, notes, ...) is completely unaffected. remark-gfm
          // already puts its own "task-list-item" class on `p.className` here, so it has to be
          // merged in rather than spread after -- spreading `dom(p)` last would silently
          // overwrite the classes set below with that one.
          li: ({ className, ...p }) => (
            <li
              className={cx(
                "pl-0.5 [&:has(>input)]:-ml-5 [&:has(>input)]:flex [&:has(>input)]:list-none [&:has(>input)]:items-start [&:has(>input)]:gap-2",
                className,
              )}
              {...dom(p)}
            />
          ),
          input: (p) => (
            <input className="mt-0.75 size-3.5 shrink-0 accent-fresh" disabled {...dom(p)} />
          ),
          strong: (p) => <strong className="font-semibold text-ink" {...dom(p)} />,
          em: (p) => <em className="italic" {...dom(p)} />,
          hr: () => <hr className="my-6 border-line" />,
          blockquote: (p) => (
            <blockquote
              className="my-3 border-l-2 border-line-strong pl-3.5 text-ink-faint"
              {...dom(p)}
            />
          ),
          a: (p) => (
            <a
              className="text-accent-ink underline-offset-2 hover:underline"
              target="_blank"
              rel="noopener noreferrer"
              {...dom(p)}
            />
          ),
          code: ({ className, children, node, ...rest }) => {
            // react-markdown gives fenced blocks a language class and inline code none, which is
            // the only reliable way to tell them apart here.
            const fenced = /language-/.test(className ?? "");

            /*
              A ```mermaid fence is a diagram, not a code sample.

              Intercepted here rather than by a remark plugin because the plugin would have to
              replace the node before rendering, and `pre` would still wrap whatever came back --
              putting a bordered code box around the diagram's own bordered box.
            */
            if (/language-mermaid/.test(className ?? "")) {
              return <Mermaid chart={String(children).replace(/\n$/, "")} />;
            }

            if (fenced) {
              return (
                <code
                  className="block font-mono text-[12.5px] leading-relaxed text-ink-dim"
                  {...rest}
                >
                  {children}
                </code>
              );
            }
            return (
              <code
                className="rounded border border-line bg-surface-2 px-1 py-0.5 font-mono text-[12px] text-ink"
                {...rest}
              >
                {children}
              </code>
            );
          },
          pre: ({ node, children, ...rest }) => {
            /*
              A mermaid fence has already become a diagram by the time `pre` sees it, and the
              diagram brings its own frame. Wrapping it again draws a box inside a box, so the
              wrapper is skipped for that one case and kept for real code.
            */
            const child = Array.isArray(children) ? children[0] : children;
            const childClass =
              child && typeof child === "object" && "props" in child
                ? String((child as { props?: { className?: string } }).props?.className ?? "")
                : "";
            if (/language-mermaid/.test(childClass)) {
              return <>{children}</>;
            }

            // Wide code scrolls inside its own box; the page itself must never scroll sideways.
            return (
              <pre
                className="my-3 overflow-x-auto rounded-card border border-line bg-surface-2 px-3.5 py-3"
                {...rest}
              >
                {children}
              </pre>
            );
          },
          table: (p) => (
            <div className="my-3 overflow-x-auto rounded-card border border-line">
              <table className="w-full border-collapse text-[12.5px]" {...dom(p)} />
            </div>
          ),
          thead: (p) => <thead className="bg-surface-2" {...dom(p)} />,
          th: (p) => (
            <th
              className="border-b border-line px-3 py-2 text-left font-medium text-ink"
              {...dom(p)}
            />
          ),
          td: (p) => <td className="border-b border-line px-3 py-2 align-top" {...dom(p)} />,
          img: (p) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="my-3 max-w-full rounded-card border border-line" alt="" {...dom(p)} />
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
