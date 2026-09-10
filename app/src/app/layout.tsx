import type { Metadata } from "next";

import { MobileNav, Sidebar } from "@/components/sidebar";
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

import "./globals.css";

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
  let counts = {
    relevantJobs: 0,
    pendingNotifications: 0,
    unhealthySources: 0,
    dsaRemaining: 0,
    pipeline: 0,
    reminders: 0,
  };
  try {
    const db = getDb();
    // The reminder badge runs the real rules rather than a SQL restatement of them. Duplicating
    // thresholds in a query is how the badge and the page start disagreeing, and a badge you
    // stop believing is worse than no badge.
    const [base, rows, settingsRows, dismissed] = await Promise.all([
      navCounts(db),
      listReminderCandidates(db),
      db.select({ reminderThresholds: settings.reminderThresholds }).from(settings).limit(1),
      reminderDismissalMap(db),
    ]);
    counts = {
      ...base,
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
    <html lang="en">
      <body className="min-h-dvh bg-canvas text-ink">
        <div className="flex min-h-dvh">
          <Sidebar counts={counts} />
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
