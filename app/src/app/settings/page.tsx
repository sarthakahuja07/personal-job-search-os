import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { Badge, Button, Card, PageHeader, SectionTitle, inputStyles } from "@/components/ui";
import { getDb } from "@/db";
import { settings } from "@/db/schema";

export const dynamic = "force-dynamic";

async function saveSettings(formData: FormData) {
  "use server";
  const db = getDb();
  const followUpDays = Number(formData.get("followUpDays") ?? 5);
  const closeAfter = Number(formData.get("closeAfterMissingRuns") ?? 3);

  await db
    .update(settings)
    .set({
      notifyEmail: String(formData.get("notifyEmail") ?? "").trim() || null,
      resumeUrl: String(formData.get("resumeUrl") ?? "").trim() || null,
      followUpDays: Number.isFinite(followUpDays) ? followUpDays : 5,
      closeAfterMissingRuns: Number.isFinite(closeAfter) ? closeAfter : 3,
      updatedAt: new Date(),
    })
    .where(eq(settings.id, 1));

  revalidatePath("/settings");
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[13px] font-medium text-ink">{label}</label>
      {hint && <p className="mb-1.5 mt-0.5 text-xs text-ink-faint">{hint}</p>}
      {children}
    </div>
  );
}

export default async function SettingsPage() {
  const db = getDb();
  const rows = await db.select().from(settings).limit(1);
  const s = rows[0];
  const rules = s?.matchRules;

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Settings"
        subtitle="Match rules live in the database, so changing them takes effect on the next crawl without a deploy."
      />

      <form action={saveSettings} className="space-y-6">
        <Card className="space-y-5 px-5 py-5">
          <SectionTitle>Notifications</SectionTitle>
          <Field
            label="Notification email"
            hint="Where the digest goes after each crawl. Without this, notifications queue but never send."
          >
            <input
              name="notifyEmail"
              type="email"
              defaultValue={s?.notifyEmail ?? ""}
              placeholder="you@example.com"
              className={inputStyles}
            />
          </Field>
          <Field label="Canonical resume link" hint="Used by message templates as {{resume_link}}.">
            <input
              name="resumeUrl"
              type="url"
              defaultValue={s?.resumeUrl ?? ""}
              placeholder="https://…"
              className={inputStyles}
            />
          </Field>
        </Card>

        <Card className="space-y-5 px-5 py-5">
          <SectionTitle>Pipeline behaviour</SectionTitle>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label="Follow up after (days)"
              hint="Days in Requested before a reminder surfaces."
            >
              <input
                name="followUpDays"
                type="number"
                min={1}
                max={30}
                defaultValue={s?.followUpDays ?? 5}
                className={inputStyles}
              />
            </Field>
            <Field
              label="Close after N missed crawls"
              hint="Only successful runs count, so a broken adapter can never close a live role."
            >
              <input
                name="closeAfterMissingRuns"
                type="number"
                min={1}
                max={20}
                defaultValue={s?.closeAfterMissingRuns ?? 3}
                className={inputStyles}
              />
            </Field>
          </div>
        </Card>

        <Button type="submit" variant="primary">
          Save changes
        </Button>
      </form>

      <Card className="mt-8 px-5 py-5">
        <SectionTitle>Active match rules</SectionTitle>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-[13px]">
          <dt className="text-ink-dim">Target level</dt>
          <dd className="text-ink">SDE-2 / SWE-2 and equivalents, including L4 and MTS-II</dd>

          <dt className="text-ink-dim">Locations</dt>
          <dd className="flex flex-wrap gap-1.5">
            {(rules?.location.allow ?? [])
              .slice()
              .sort((a, b) => a.priority - b.priority)
              .map((l, i) => (
                <Badge key={l.name} tone={i === 0 ? "accent" : "neutral"}>
                  {l.priority}. {l.name}
                </Badge>
              ))}
          </dd>

          <dt className="text-ink-dim">Experience</dt>
          <dd className="text-ink">
            up to {rules?.experience.idealMaxYears ?? 4} years, rejected at{" "}
            {rules?.experience.hardRejectYears ?? 7}+
          </dd>

          <dt className="text-ink-dim">Patterns</dt>
          <dd className="tnum text-ink">
            {rules?.title.include.length ?? 0} include · {rules?.title.exclude.length ?? 0}{" "}
            exclude
          </dd>
        </dl>
        <p className="mt-4 text-xs leading-relaxed text-ink-faint">
          Exclusions cover seniority above and below target, non-engineering roles, hardware and
          silicon, and — at your request — security and networking. Every job stores the reason
          it matched, so a filtering decision is always auditable rather than a black box.
        </p>
      </Card>
    </div>
  );
}
