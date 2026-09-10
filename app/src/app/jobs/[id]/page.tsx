import Link from "next/link";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";

import { CopyLink } from "@/components/copy-link";
import { Badge, Card, PageHeader, SectionTitle, cx } from "@/components/ui";
import { getDb } from "@/db";
import { STAGES, STAGE_LABEL, isStage } from "@/server/domain/applications";
import { whatsappLink } from "@/server/domain/templates";
import { getByJobId, setStage } from "@/server/repository/applications-repo";
import { contactsForCompany, getJob } from "@/server/repository/jobs-repo";

export const dynamic = "force-dynamic";

const LOCATION_LABEL: Record<number, string> = {
  1: "Bangalore",
  2: "Gurgaon",
  3: "Remote",
  4: "Hyderabad",
};

async function moveStage(formData: FormData) {
  "use server";
  const jobId = String(formData.get("jobId"));
  const companyId = String(formData.get("companyId"));
  const stage = String(formData.get("stage"));
  if (!isStage(stage)) return;

  await setStage(getDb(), jobId, companyId, stage);
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/applications");
  revalidatePath("/jobs");
  revalidatePath("/");
}

function when(date: Date | null): string {
  if (!date) return "unknown";
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return `${Math.floor(days / 30)} months ago`;
}

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const db = getDb();

  const job = await getJob(db, id);
  if (!job) notFound();

  const [contacts, application] = await Promise.all([
    contactsForCompany(db, job.companyId),
    getByJobId(db, id),
  ]);

  const currentStage = application?.status ?? null;

  return (
    <div className="max-w-3xl">
      <PageHeader
        title={job.title}
        subtitle={
          <>
            <Link href={`/jobs?company=${job.companyId}`} className="text-ink hover:underline">
              {job.companyName}
            </Link>
            {job.location && <> · {job.location}</>}
            {job.department && <> · {job.department}</>}
          </>
        }
        actions={
          <Link href="/jobs" className="text-body text-ink-dim transition hover:text-ink">
            ← Jobs
          </Link>
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        {job.closedAt ? (
          <Badge tone="danger">Closed</Badge>
        ) : job.isRelevant ? (
          <Badge tone="fresh">Matches your rules</Badge>
        ) : (
          <Badge>Not a match</Badge>
        )}
        {job.locationPriority && (
          <Badge tone="accent">{LOCATION_LABEL[job.locationPriority]}</Badge>
        )}
        <span className="tnum text-label text-ink-faint">score {job.matchScore}</span>
        <span className="ml-auto flex items-center gap-2">
          <CopyLink url={job.jobUrl} />
          <a
            href={job.jobUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-control bg-accent px-3 py-1.5 text-body font-medium text-canvas transition hover:brightness-110"
          >
            Open original posting ↗
          </a>
        </span>
      </div>

      {/* Why this job was surfaced, in the app's own words. Filtering is never a black box. */}
      {job.matchReason && (
        <Card className="mb-6 px-4 py-3">
          <p className="text-label uppercase tracking-wide text-ink-faint">Why this matched</p>
          <p className="mt-1 text-body text-ink-dim">{job.matchReason}</p>
        </Card>
      )}

      <SectionTitle>Pipeline</SectionTitle>
      <Card className="mb-6 px-4 py-4">
        <div className="flex flex-wrap gap-2">
          {STAGES.map((stage) => (
            <form key={stage} action={moveStage}>
              <input type="hidden" name="jobId" value={job.id} />
              <input type="hidden" name="companyId" value={job.companyId} />
              <input type="hidden" name="stage" value={stage} />
              <button
                type="submit"
                className={cx(
                  "rounded-control border px-3 py-1.5 text-body transition",
                  currentStage === stage
                    ? "border-line-strong bg-surface-3 text-ink"
                    : "border-line bg-surface-2 text-ink-dim hover:border-line-strong hover:text-ink",
                )}
              >
                {STAGE_LABEL[stage]}
              </button>
            </form>
          ))}
        </div>
        {currentStage ? (
          <p className="mt-3 text-label text-ink-faint">
            Currently <span className="text-ink-dim">{STAGE_LABEL[currentStage]}</span>
            {application?.requestedAt && (
              <> · referral requested {when(application.requestedAt)}</>
            )}
            {" · "}
            <Link href="/applications" className="text-ink hover:underline">
              open the board
            </Link>
          </p>
        ) : (
          <p className="mt-3 text-label text-ink-faint">
            Not in the pipeline yet. Pick a stage to add it.
          </p>
        )}
      </Card>

      <SectionTitle>
        {contacts.length > 0
          ? `Your contacts at ${job.companyName}`
          : `No contacts at ${job.companyName}`}
      </SectionTitle>
      <Card className="mb-6 px-4 py-4">
        {contacts.length === 0 ? (
          <p className="text-body text-ink-dim">
            You have no referral contact here — which is normal, and not a blocker. Apply
            directly through the posting.
          </p>
        ) : (
          <ul className="space-y-2.5">
            {contacts.map((c) => {
              const message =
                `Hi ${c.name}, hope you're doing well! I saw a ${job.title} opening at ` +
                `${job.companyName} that I'm really interested in — ${job.jobUrl}\n\n` +
                `Would you be open to referring me?`;
              const wa = whatsappLink(c.phone, message);
              return (
                <li
                  key={c.id}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-line/60 pb-2.5 last:border-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="text-body font-medium text-ink">{c.name}</p>
                    <p className="text-label text-ink-faint">
                      {[c.phone, c.email].filter(Boolean).join(" · ") || "no contact details"}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <Link
                      href={`/templates?job=${job.id}`}
                      className="rounded-control border border-line bg-surface-2 px-2.5 py-1 text-meta text-ink-dim transition hover:border-line-strong hover:text-ink"
                    >
                      Compose
                    </Link>
                    {wa && (
                      <a
                        href={wa}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-control border border-line bg-surface-2 px-2.5 py-1 text-meta text-ink-dim transition hover:border-line-strong hover:text-ink"
                      >
                        WhatsApp
                      </a>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {job.description && (
        <>
          <SectionTitle>Description</SectionTitle>
          <Card className="mb-6 px-5 py-4">
            <div className="whitespace-pre-wrap text-body leading-relaxed text-ink-dim">
              {job.description}
            </div>
          </Card>
        </>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-label text-ink-faint">
        <span>Posted {when(job.postedAt)}</span>
        <span>Discovered {when(job.discoveredAt)}</span>
        <span>Source {job.source}</span>
        <span>Ref {job.externalJobId}</span>
      </div>
    </div>
  );
}
