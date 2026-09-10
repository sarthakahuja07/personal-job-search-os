import Link from "next/link";

import { Badge, Card, PageHeader, SectionTitle, cx } from "@/components/ui";
import { OnboardForm } from "./onboard-form";
import { getDb } from "@/db";
import { listCompanyHealth } from "@/server/repository/jobs-repo";

export const dynamic = "force-dynamic";

const HEALTH_TONE = {
  healthy: "fresh",
  degraded: "warn",
  suspicious: "warn",
  failing: "danger",
  unknown: "neutral",
} as const;

const TIER_LABEL: Record<number, string> = {
  1: "ATS feed",
  2: "Workday",
  3: "Custom",
  4: "JSON-LD",
  5: "HTML",
  6: "Manual",
};

function ago(date: Date | null): string {
  if (!date) return "never";
  const mins = Math.floor((Date.now() - date.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default async function CompaniesPage() {
  const companies = await listCompanyHealth(getDb());
  const automated = companies.filter((c) => c.active && c.sourceType !== "manual");
  const manual = companies.filter((c) => c.active && c.sourceType === "manual");
  const inactive = companies.filter((c) => !c.active);

  return (
    <div>
      <PageHeader
        title="Companies"
        subtitle={
          <>
            <span className="tnum text-ink">{automated.length}</span> crawled automatically ·{" "}
            <span className="tnum text-ink">{manual.length}</span> checked by hand
          </>
        }
      />

      <Card className="mb-6 px-5 py-4">
        <p className="text-[13px] font-medium text-ink">Add a company</p>
        <p className="mb-3 mt-0.5 text-[11px] leading-relaxed text-ink-faint">
          Paste the URL you land on when you click &ldquo;search jobs&rdquo;. Greenhouse, Lever,
          Ashby, SmartRecruiters and Workday URLs are recognised automatically; anything else is
          saved as a manual check rather than guessed at. <strong>Check source</strong> fetches
          the board first, because a mistyped token detects perfectly and then returns nothing
          forever.
        </p>
        <OnboardForm />
      </Card>

      <SectionTitle>Automated sources</SectionTitle>
      <Card className="mb-8 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-faint">
              <th className="px-4 py-2.5 font-medium">Company</th>
              <th className="px-4 py-2.5 font-medium">Source</th>
              <th className="px-4 py-2.5 font-medium">Health</th>
              <th className="px-4 py-2.5 font-medium">Last success</th>
            </tr>
          </thead>
          <tbody>
            {automated.map((c, i) => (
              <tr
                key={c.id}
                className={cx(
                  "transition hover:bg-surface-2",
                  i > 0 && "border-t border-line/60",
                )}
              >
                <td className="px-4 py-2.5">
                  <Link
                    href={`/companies/${c.id}`}
                    className="font-medium text-ink transition hover:text-accent-ink"
                  >
                    {c.name}
                  </Link>
                  {c.lastError && (
                    <p className="mt-0.5 max-w-md text-xs text-ink-dim">{c.lastError}</p>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-ink-dim">
                  {TIER_LABEL[c.sourceTier] ?? c.sourceType}
                </td>
                <td className="px-4 py-2.5">
                  <Badge tone={HEALTH_TONE[c.healthStatus]}>{c.healthStatus}</Badge>
                </td>
                <td className="tnum whitespace-nowrap px-4 py-2.5 text-ink-faint">
                  {ago(c.lastSuccessAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <SectionTitle>Checked by hand</SectionTitle>
      <Card className="mb-6 px-4 py-4">
        <p className="mb-3 text-xs leading-relaxed text-ink-dim">
          These render their listings in the browser, or decline automated access. Rather than
          work around that, the link opens the board directly — a reliable manual check beats an
          automated one that silently rots.
        </p>
        <ul className="flex flex-wrap gap-1.5">
          {/* The company name goes to the company, everywhere. It used to open the external
              board here, which made a manual company the one kind you could not click through
              to its own contacts -- and one with no careers URL had no link at all. The board
              is still one click away, just labelled as what it is. */}
          {manual.map((c) => (
            <li key={c.id} className="flex items-center">
              <Link
                href={`/companies/${c.id}`}
                className={cx(
                  "rounded-l-md border border-line bg-surface-2 px-2.5 py-1 text-[13px] text-ink-dim transition hover:border-line-strong hover:text-ink",
                  !c.careersUrl && "rounded-r-md",
                )}
              >
                {c.name}
              </Link>
              {c.careersUrl && (
                <a
                  href={c.careersUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`Open ${c.name}'s job board`}
                  className="rounded-r-md border border-l-0 border-line bg-surface-2 px-2 py-1 text-[12px] text-ink-faint transition hover:border-line-strong hover:text-ink"
                >
                  board ↗
                </a>
              )}
            </li>
          ))}
        </ul>
      </Card>

      {inactive.length > 0 && (
        <p className="text-[11px] text-ink-faint">
          Inactive: {inactive.map((c) => c.name).join(", ")}
        </p>
      )}
    </div>
  );
}
