"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { NavTree, type NavNode } from "./nav-tree";
import { cx } from "./ui";

/**
 * Primary navigation.
 *
 * Grouped rather than flat because this is two products sharing a database: discovering and
 * chasing jobs, and preparing for the interviews they lead to. Those are different modes of
 * work -- one is checked several times a day, the other is sat down with -- and flattening them
 * into a single list of nine items would blur that.
 *
 * Both halves are real and complete: Phase 0 discovers and tracks roles through a five-stage
 * pipeline, Phase 1 prepares for the interviews they lead to.
 */

type Item = {
  href: string;
  label: string;
  count?: number;
};

type Group = { title: string; items: Item[]; tree?: boolean };

export type NavCounts = {
  relevantJobs?: number;
  pendingNotifications?: number;
  unhealthySources?: number;
  dsaRemaining?: number;
  pipeline?: number;
  reminders: number;
  linkedin?: number;
};

function groups(counts: NavCounts): Group[] {
  return [
    {
      title: "Job Search",
      items: [
        { href: "/", label: "Dashboard" },
        { href: "/jobs", label: "Jobs", count: counts.relevantJobs },
        { href: "/linkedin", label: "LinkedIn", count: counts.linkedin },
        { href: "/companies", label: "Companies", count: counts.unhealthySources },
        { href: "/applications", label: "Applications", count: counts.pipeline },
        { href: "/reminders", label: "Reminders", count: counts.reminders },
        { href: "/templates", label: "Templates" },
        {
          href: "/notifications",
          label: "Notifications",
          count: counts.pendingNotifications,
        },
      ],
    },
    {
      title: "Preparation",
      // Just the overview; the disciplines and their pages render as a tree below, because a
      // flat list cannot show that RDBMS sits inside HLD inside System Design.
      items: [
        { href: "/prep", label: "Overview" },
        { href: "/prep/books/system-design-interview-vol-1", label: "Alex Xu · Vol 1" },
        { href: "/prep/books/system-design-interview-vol-2", label: "Alex Xu · Vol 2" },
      ],
      tree: true,
    },
    {
      title: "Workspace",
      items: [{ href: "/settings", label: "Settings" }],
    },
  ];
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export function Sidebar({
  counts,
  prepTree = [],
}: {
  counts: NavCounts;
  prepTree?: NavNode[];
}) {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 hidden h-dvh w-[228px] shrink-0 flex-col border-r border-line bg-surface md:flex">
      <div className="flex h-14 items-center gap-2.5 border-b border-line px-5">
        <span className="grid size-6 place-items-center rounded bg-accent-soft text-[11px] font-bold text-accent-ink">
          JS
        </span>
        <span className="text-[13px] font-semibold tracking-tight text-ink">
          Job Search OS
        </span>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {groups(counts).map((group) => (
          <div key={group.title} className="mb-5">
            <div className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-faint">
              {group.title}
            </div>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cx(
                        "group flex items-center justify-between rounded-md px-2 py-1.5 text-[13px] transition",
                        active
                          ? "bg-accent-soft font-medium text-accent-ink"
                          : "text-ink-dim hover:bg-surface-2 hover:text-ink",
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <span
                          className={cx(
                            "h-3.5 w-0.5 rounded transition",
                            active ? "bg-accent" : "bg-transparent",
                          )}
                          aria-hidden
                        />
                        {item.label}
                      </span>
                      {item.count ? (
                        <span className="tnum rounded bg-surface-3 px-1.5 text-[11px] text-ink-dim">
                          {item.count}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
            {group.tree && prepTree.length > 0 && (
              <div className="mt-1">
                <NavTree nodes={prepTree} />
              </div>
            )}
          </div>
        ))}
      </nav>

      <div className="border-t border-line px-5 py-3 text-[11px] leading-relaxed text-ink-faint">
        Discovery · Pipeline · Prep
      </div>
    </aside>
  );
}

/** Horizontal nav for narrow screens, where a 228px rail would eat the content. */
export function MobileNav({ counts }: { counts: NavCounts }) {
  const pathname = usePathname();
  const items = groups(counts).flatMap((g) => g.items);

  return (
    <div className="border-b border-line bg-surface md:hidden">
      <div className="flex items-center gap-2 overflow-x-auto px-4 py-2.5">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cx(
              "whitespace-nowrap rounded-md px-2.5 py-1 text-[13px] transition",
              isActive(pathname, item.href)
                ? "bg-accent-soft font-medium text-accent-ink"
                : "text-ink-dim",
            )}
          >
            {item.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
