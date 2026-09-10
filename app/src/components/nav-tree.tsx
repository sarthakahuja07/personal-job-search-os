"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useSyncExternalStore } from "react";

import { cx } from "./ui";

export type NavNode = {
  slug: string;
  title: string;
  href: string;
  children: NavNode[];
};

const STORE_KEY = "prep-nav-open";

/**
 * Which branches are open, kept in localStorage.
 *
 * Read through useSyncExternalStore rather than an effect that calls setState: the server has
 * no localStorage, so the value has to differ between the server render and the first client
 * one, and this is the API built for exactly that. Doing it with an effect works but renders
 * twice and trips react-hooks for good reason.
 */
const listeners = new Set<() => void>();

function readOpen(): string {
  // Throws outright in some embedded contexts. A nav that crashes the page is far worse than
  // one that forgets which folders were open.
  try {
    return window.localStorage.getItem(STORE_KEY) ?? "[]";
  } catch {
    return "[]";
  }
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function writeOpen(next: string[]) {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(next));
  } catch {
    /* the tree still works for this session */
  }
  for (const l of listeners) l();
}

/**
 * The preparation directory, as a tree you can walk without leaving the page you are on.
 *
 * Collapsed by default and expanded along the current path. That combination is what keeps a
 * sidebar usable once a discipline has sixty pages: everything is reachable, nothing is
 * unfolded until asked for, and the page you are reading is always visible in context.
 */
export function NavTree({ nodes }: { nodes: NavNode[] }) {
  const pathname = usePathname();
  const raw = useSyncExternalStore(subscribe, readOpen, () => "[]");

  const open = useMemo(() => {
    try {
      const parsed: unknown = JSON.parse(raw);
      return new Set<string>(Array.isArray(parsed) ? (parsed as string[]) : []);
    } catch {
      return new Set<string>();
    }
  }, [raw]);

  const toggle = (href: string) => {
    const next = new Set(open);
    if (next.has(href)) next.delete(href);
    else next.add(href);
    writeOpen([...next]);
  };

  return (
    <ul className="space-y-0.5">
      {nodes.map((n) => (
        <TreeRow key={n.href} node={n} depth={0} pathname={pathname} open={open} toggle={toggle} />
      ))}
    </ul>
  );
}

function TreeRow({
  node,
  depth,
  pathname,
  open,
  toggle,
}: {
  node: NavNode;
  depth: number;
  pathname: string;
  open: Set<string>;
  toggle: (href: string) => void;
}) {
  const onPath = pathname === node.href || pathname.startsWith(node.href + "/");
  const active = pathname === node.href;
  const hasKids = node.children.length > 0;
  // On the current path it is always open: you should never have to re-expand your way back to
  // where you already are.
  const expanded = hasKids && (open.has(node.href) || onPath);

  return (
    <li>
      <div
        className={cx(
          "group flex items-center rounded-md pr-1.5 transition",
          active ? "bg-accent-soft" : "hover:bg-surface-2",
        )}
        style={{ paddingLeft: depth * 10 }}
      >
        {hasKids ? (
          <button
            type="button"
            onClick={() => toggle(node.href)}
            aria-label={expanded ? `Collapse ${node.title}` : `Expand ${node.title}`}
            aria-expanded={expanded}
            className="grid size-5 shrink-0 place-items-center rounded text-ink-faint transition hover:bg-surface-3 hover:text-ink"
          >
            <svg
              viewBox="0 0 12 12"
              className={cx("size-3 transition-transform", expanded && "rotate-90")}
              aria-hidden
            >
              <path d="M4.5 2.5 8 6l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </button>
        ) : (
          <span className="size-5 shrink-0" aria-hidden />
        )}

        <Link
          href={node.href}
          className={cx(
            "min-w-0 flex-1 truncate py-1.5 text-[13px] transition",
            active
              ? "font-medium text-accent-ink"
              : onPath
                ? "text-ink"
                : "text-ink-dim group-hover:text-ink",
          )}
          title={node.title}
        >
          {node.title}
        </Link>
      </div>

      {expanded && (
        <ul className="mt-0.5 space-y-0.5 border-l border-line" style={{ marginLeft: depth * 10 + 10 }}>
          {node.children.map((c) => (
            <TreeRow
              key={c.href}
              node={c}
              depth={0}
              pathname={pathname}
              open={open}
              toggle={toggle}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
