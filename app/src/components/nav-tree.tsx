"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState, useSyncExternalStore, useTransition } from "react";

import { movePrepPage } from "@/app/prep/actions";
import { ScoreBadge } from "./score";
import { cx } from "./ui";

export type NavNode = {
  id: string;
  parentId: string | null;
  slug: string;
  title: string;
  href: string;
  /** How often it is asked, 0-100. Shown beside the name so the tree itself ranks the work. */
  score: number;
  children: NavNode[];
};

/** Where a drop would land: above the row, below it, or inside it. */
type DropZone = "before" | "after" | "inside";

const STORE_KEY = "prep-nav-open";

/**
 * Which branches you have opened or closed, kept in localStorage.
 *
 * A map rather than a set of open hrefs, because there are three states and not two: opened by
 * hand, closed by hand, and never touched. Only the third should fall back to "open if it is
 * on the current path" -- storing a set collapsed the first and third together, so a folder
 * containing the page you were reading forced itself open and its collapse button did nothing.
 *
 * Read through useSyncExternalStore rather than an effect that calls setState: the server has
 * no localStorage, so the value has to differ between the server render and the first client
 * one, and this is the API built for exactly that.
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

function writeOpen(next: Record<string, boolean>) {
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
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; zone: DropZone } | null>(null);
  const [, startTransition] = useTransition();

  const drop = (target: NavNode, zone: DropZone, siblings: NavNode[]) => {
    const sourceId = dragging;
    setDragging(null);
    setOver(null);
    if (!sourceId || sourceId === target.id) return;

    // Dropping into a discipline row means the top level of that discipline, which is a null
    // parent -- there is no row to point at.
    if (zone === "inside") {
      startTransition(() => void movePrepPage(sourceId, target.id || null, 0));
      return;
    }
    // Reordering against a discipline row is meaningless: they are fixed and not siblings of
    // anything in the database.
    if (!target.id) return;
    const index = siblings.findIndex((s) => s.id === target.id);
    const at = zone === "before" ? index : index + 1;
    startTransition(() => void movePrepPage(sourceId, target.parentId, at));
  };

  const open = useMemo(() => {
    try {
      const parsed: unknown = JSON.parse(raw);
      // Older builds stored an array of open hrefs. Read it as "all of these were opened"
      // rather than discarding it, so nobody's tree collapses on upgrade.
      if (Array.isArray(parsed)) {
        return Object.fromEntries((parsed as string[]).map((h) => [h, true]));
      }
      if (parsed && typeof parsed === "object") return parsed as Record<string, boolean>;
      return {};
    } catch {
      return {};
    }
  }, [raw]);

  // `wasOpen` is what the row is showing right now, which is what the click is reacting to --
  // including when that came from the row being on the current path.
  const toggle = (href: string, wasOpen: boolean) => {
    writeOpen({ ...open, [href]: !wasOpen });
  };

  return (
    <ul className="space-y-0.5">
      {nodes.map((n) => (
        <TreeRow
          key={n.href}
          node={n}
          siblings={nodes}
          depth={0}
          pathname={pathname}
          open={open}
          toggle={toggle}
          dragging={dragging}
          setDragging={setDragging}
          over={over}
          setOver={setOver}
          onDrop={drop}
        />
      ))}
    </ul>
  );
}

function TreeRow({
  node,
  siblings,
  depth,
  pathname,
  open,
  toggle,
  dragging,
  setDragging,
  over,
  setOver,
  onDrop,
}: {
  node: NavNode;
  siblings: NavNode[];
  depth: number;
  pathname: string;
  open: Record<string, boolean>;
  toggle: (href: string, wasOpen: boolean) => void;
  dragging: string | null;
  setDragging: (id: string | null) => void;
  over: { id: string; zone: DropZone } | null;
  setOver: (v: { id: string; zone: DropZone } | null) => void;
  onDrop: (target: NavNode, zone: DropZone, siblings: NavNode[]) => void;
}) {
  const onPath = pathname === node.href || pathname.startsWith(node.href + "/");
  const active = pathname === node.href;
  const hasKids = node.children.length > 0;
  // An explicit choice always wins. Absent one, a folder holding the page you are reading opens
  // itself, so you never have to expand your way back to where you already are.
  const explicit = open[node.href];
  const expanded = hasKids && (explicit ?? onPath);
  const zone = over?.id === node.id ? over.zone : null;

  // The top and bottom quarters reorder; the middle nests. Same convention as Notion, and it
  // is the only way to express both intents with one pointer and no modifier key.
  const zoneFor = (e: React.DragEvent<HTMLDivElement>): DropZone => {
    const r = e.currentTarget.getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height;
    if (y < 0.25) return "before";
    if (y > 0.75) return "after";
    return "inside";
  };

  return (
    <li>
      <div
        draggable={Boolean(node.id)}
        onDragStart={(e) => {
          if (!node.id) return;
          e.stopPropagation();
          setDragging(node.id);
          e.dataTransfer.effectAllowed = "move";
          // Firefox refuses to start a drag without payload, whatever the handlers say.
          e.dataTransfer.setData("text/plain", node.id);
        }}
        onDragEnd={() => {
          setDragging(null);
          setOver(null);
        }}
        onDragOver={(e) => {
          if (!dragging || dragging === node.id) return;
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = "move";
          setOver({ id: node.id, zone: zoneFor(e) });
        }}
        onDragLeave={(e) => {
          e.stopPropagation();
          if (over?.id === node.id) setOver(null);
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onDrop(node, zoneFor(e), siblings);
        }}
        className={cx(
          "group flex items-center rounded-md pr-1.5 transition",
          active ? "bg-accent-soft" : "hover:bg-surface-2",
          dragging === node.id && "opacity-40",
          zone === "inside" && "ring-1 ring-inset ring-accent",
          zone === "before" && "border-t-2 border-accent",
          zone === "after" && "border-b-2 border-accent",
        )}
        style={{ paddingLeft: depth * 10 }}
      >
        {hasKids ? (
          <button
            type="button"
            onClick={() => toggle(node.href, expanded)}
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

        <ScoreBadge score={node.score} className="ml-1.5" />
      </div>

      {expanded && (
        <ul className="mt-0.5 space-y-0.5 border-l border-line" style={{ marginLeft: depth * 10 + 10 }}>
          {node.children.map((c) => (
            <TreeRow
              key={c.href}
              node={c}
              siblings={node.children}
              depth={0}
              pathname={pathname}
              open={open}
              toggle={toggle}
              dragging={dragging}
              setDragging={setDragging}
              over={over}
              setOver={setOver}
              onDrop={onDrop}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
