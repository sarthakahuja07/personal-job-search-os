import type { Metadata } from "next";

import { MobileNav, Sidebar } from "@/components/sidebar";
import { getDb } from "@/db";
import { navCounts } from "@/server/repository/jobs-repo";

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
  let counts = { relevantJobs: 0, pendingNotifications: 0, unhealthySources: 0, dsaRemaining: 0, pipeline: 0 };
  try {
    counts = await navCounts(getDb());
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
