import Link from "next/link";

import { getDb } from "@/db";
import { listCompanyHealth } from "@/server/repository/jobs-repo";

export const dynamic = "force-dynamic";

const HEALTH_STYLE: Record<string, string> = {
  healthy: "bg-emerald-100 text-emerald-800",
  degraded: "bg-amber-100 text-amber-800",
  suspicious: "bg-amber-100 text-amber-900",
  failing: "bg-red-100 text-red-800",
  unknown: "bg-neutral-100 text-neutral-600",
};

const TIER_LABEL: Record<number, string> = {
  1: "ATS feed",
  2: "Workday",
  3: "Custom adapter",
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
  const active = companies.filter((c) => c.active);
  const inactive = companies.filter((c) => !c.active);

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight">Companies</h1>
      <p className="mt-1 text-sm text-neutral-500">
        {active.length} active &middot; {active.filter((c) => c.sourceType !== "manual").length}{" "}
        crawled automatically
      </p>

      <div className="mt-5 overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-4 py-2 font-medium">Company</th>
              <th className="px-4 py-2 font-medium">Source</th>
              <th className="px-4 py-2 font-medium">Health</th>
              <th className="px-4 py-2 font-medium">Last success</th>
              <th className="px-4 py-2 font-medium">Jobs</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {active.map((c) => (
              <tr key={c.id} className="align-top">
                <td className="px-4 py-2">
                  <Link href={`/jobs?company=${c.id}`} className="font-medium hover:underline">
                    {c.name}
                  </Link>
                  {c.lastError && (
                    <p className="mt-0.5 max-w-md text-xs text-neutral-500">{c.lastError}</p>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-2 text-neutral-600">
                  {TIER_LABEL[c.sourceTier] ?? c.sourceType}
                </td>
                <td className="px-4 py-2">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${HEALTH_STYLE[c.healthStatus]}`}
                  >
                    {c.healthStatus}
                  </span>
                </td>
                <td className="whitespace-nowrap px-4 py-2 text-neutral-500">
                  {ago(c.lastSuccessAt)}
                </td>
                <td className="px-4 py-2">
                  <Link
                    href={`/jobs?company=${c.id}&all=1`}
                    className="text-neutral-500 hover:underline"
                  >
                    view
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {inactive.length > 0 && (
        <p className="mt-3 text-xs text-neutral-400">
          Inactive: {inactive.map((c) => c.name).join(", ")}
        </p>
      )}
    </div>
  );
}
