import type { Metadata } from "next";
import { Inter } from "next/font/google";

import { MobileNav, Sidebar } from "@/components/sidebar";
import { PrepSearch } from "@/components/prep-search";
import { getDb } from "@/db";
import { settings } from "@/db/schema";
import {
  buildReminders,
  DEFAULT_THRESHOLDS,
  type ReminderCandidate,
} from "@/server/domain/reminders";
import {
  listReminderCandidates,
  navCounts,
  reminderDismissalMap,
} from "@/server/repository/jobs-repo";
import { linkedinCounts } from "@/server/repository/linkedin-repo";
import { navTree } from "@/server/repository/prep-repo";
import { KINDS } from "@/server/domain/prep";
import type { NavNode } from "@/components/nav-tree";

import "./globals.css";

// System sans (San Francisco / Segoe UI / Roboto) renders noticeably thinner and tighter than
// Notion's typeface at the sizes this app uses. Inter is a free, self-hosted (built at compile
// time, no runtime request) drop-in that reads heavier and more open at the same weight, which is
// most of what closes the gap without hand-tuning every font-weight and letter-spacing value.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: "Job Search OS",
  description: "Personal job search and interview preparation",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Nav badges are live, so a broken crawler is visible from any page rather than only from
  // the dashboard. If the query fails the shell must still render -- navigation is how you
  // reach the page that would tell you what went wrong.
  let prepTree: NavNode[] = [];
  let counts = {
    relevantJobs: 0,
    pendingNotifications: 0,
    unhealthySources: 0,
    dsaRemaining: 0,
    pipeline: 0,
    reminders: 0,
    linkedin: 0,
  };
  try {
    const db = getDb();
    // The reminder badge runs the real rules rather than a SQL restatement of them. Duplicating
    // thresholds in a query is how the badge and the page start disagreeing, and a badge you
    // stop believing is worse than no badge.
    const [base, rows, settingsRows, dismissed, linkedin] = await Promise.all([
      navCounts(db),
      listReminderCandidates(db),
      db.select({ reminderThresholds: settings.reminderThresholds }).from(settings).limit(1),
      reminderDismissalMap(db),
      linkedinCounts(db),
    ]);

    // One flat query, nested here. Each discipline becomes a branch whose children are its
    // top-level pages, so the sidebar mirrors the directory rather than restating it.
    const prepRows = await navTree(db);
    const childrenOfId = new Map<string | null, typeof prepRows>();
    for (const r of prepRows) {
      const key = r.parentId;
      childrenOfId.set(key, [...(childrenOfId.get(key) ?? []), r]);
    }
    const build = (parentId: string | null, kind: string, base: string): NavNode[] =>
      (childrenOfId.get(parentId) ?? [])
        .filter((r) => r.kind === kind)
        .map((r) => ({
          id: r.id,
          parentId: r.parentId,
          slug: r.slug,
          title: r.title,
          kind: r.kind,
          score: r.frequency ?? 0,
          difficulty: r.difficulty,
          href: `${base}/${r.slug}`,
          children: build(r.id, kind, `${base}/${r.slug}`),
        }));

    // A discipline is not a row -- it is the KINDS entry. The empty id marks it as such, so
    // the tree knows it cannot be dragged and that dropping into it means "top level".
    prepTree = KINDS.map((k) => ({
      id: "",
      parentId: null,
      slug: k.segment,
      title: k.title,
      kind: k.kind,
      score: 0,
      difficulty: null,
      href: `/prep/${k.segment}`,
      children: build(null, k.kind, `/prep/${k.segment}`),
    }));
    counts = {
      ...base,
      // Unreviewed LinkedIn jobs plus companies waiting on a decision: both are things the
      // page can act on, and splitting them into two badges would say less, not more.
      linkedin: linkedin.unreadJobs + linkedin.leads,
      reminders: buildReminders(
        rows.map((r) => ({ ...r, hasContact: Boolean(r.hasContact) })) as ReminderCandidate[],
        { ...DEFAULT_THRESHOLDS, ...(settingsRows[0]?.reminderThresholds ?? {}) },
        new Date(),
        dismissed,
      ).length,
    };
  } catch {
    // fall through with zeroes
  }

  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-dvh bg-canvas text-ink">
        <PrepSearch />
        <div className="flex min-h-dvh">
          <Sidebar counts={counts} prepTree={prepTree} />
          <div className="flex min-w-0 flex-1 flex-col">
            <MobileNav counts={counts} />
            <main className="mx-auto w-full max-w-[1100px] px-5 py-8 md:px-8">
              {children}
            </main>
          </div>
        </div>
      </body>
    </html>
  );
}
