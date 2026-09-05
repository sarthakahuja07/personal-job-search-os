import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { getDb } from "@/db";
import { settings } from "@/db/schema";

export const dynamic = "force-dynamic";

async function saveSettings(formData: FormData) {
  "use server";
  const db = getDb();
  const notifyEmail = String(formData.get("notifyEmail") ?? "").trim() || null;
  const resumeUrl = String(formData.get("resumeUrl") ?? "").trim() || null;
  const followUpDays = Number(formData.get("followUpDays") ?? 5);
  const closeAfter = Number(formData.get("closeAfterMissingRuns") ?? 3);

  await db
    .update(settings)
    .set({
      notifyEmail,
      resumeUrl,
      followUpDays: Number.isFinite(followUpDays) ? followUpDays : 5,
      closeAfterMissingRuns: Number.isFinite(closeAfter) ? closeAfter : 3,
      updatedAt: new Date(),
    })
    .where(eq(settings.id, 1));

  revalidatePath("/settings");
}

export default async function SettingsPage() {
  const db = getDb();
  const rows = await db.select().from(settings).limit(1);
  const s = rows[0];

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Match rules live in the database too, so changing them takes effect on the next crawl
        without a deploy.
      </p>

      <form action={saveSettings} className="mt-6 space-y-5">
        <div>
          <label htmlFor="notifyEmail" className="block text-sm font-medium">
            Notification email
          </label>
          <p className="mb-1 text-xs text-neutral-500">
            Where the digest goes after each crawl. Without this, notifications queue but never send.
          </p>
          <input
            id="notifyEmail"
            name="notifyEmail"
            type="email"
            defaultValue={s?.notifyEmail ?? ""}
            placeholder="you@example.com"
            className="w-full rounded border border-neutral-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-neutral-500"
          />
        </div>

        <div>
          <label htmlFor="resumeUrl" className="block text-sm font-medium">
            Canonical resume link
          </label>
          <p className="mb-1 text-xs text-neutral-500">
            Used by message templates as {"{{resume_link}}"}.
          </p>
          <input
            id="resumeUrl"
            name="resumeUrl"
            type="url"
            defaultValue={s?.resumeUrl ?? ""}
            placeholder="https://..."
            className="w-full rounded border border-neutral-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-neutral-500"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="followUpDays" className="block text-sm font-medium">
              Follow-up after (days)
            </label>
            <p className="mb-1 text-xs text-neutral-500">
              Days in &ldquo;Requested&rdquo; before a reminder surfaces.
            </p>
            <input
              id="followUpDays"
              name="followUpDays"
              type="number"
              min={1}
              max={30}
              defaultValue={s?.followUpDays ?? 5}
              className="w-full rounded border border-neutral-300 bg-white px-3 py-1.5 text-sm"
            />
          </div>
          <div>
            <label htmlFor="closeAfterMissingRuns" className="block text-sm font-medium">
              Close job after N missed crawls
            </label>
            <p className="mb-1 text-xs text-neutral-500">
              Only successful runs count, so a broken adapter cannot close anything.
            </p>
            <input
              id="closeAfterMissingRuns"
              name="closeAfterMissingRuns"
              type="number"
              min={1}
              max={20}
              defaultValue={s?.closeAfterMissingRuns ?? 3}
              className="w-full rounded border border-neutral-300 bg-white px-3 py-1.5 text-sm"
            />
          </div>
        </div>

        <button
          type="submit"
          className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
        >
          Save
        </button>
      </form>

      <div className="mt-8 rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-semibold">Current match rules</h2>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-neutral-600">
          <dt>Include patterns</dt>
          <dd className="tabular-nums">{s?.matchRules?.title.include.length ?? 0}</dd>
          <dt>Exclude patterns</dt>
          <dd className="tabular-nums">{s?.matchRules?.title.exclude.length ?? 0}</dd>
          <dt>Locations</dt>
          <dd>
            {(s?.matchRules?.location.allow ?? [])
              .slice()
              .sort((a, b) => a.priority - b.priority)
              .map((l) => l.name)
              .join(" › ")}
          </dd>
          <dt>Experience target</dt>
          <dd>
            up to {s?.matchRules?.experience.idealMaxYears ?? 4} yrs (reject at{" "}
            {s?.matchRules?.experience.hardRejectYears ?? 7})
          </dd>
        </dl>
      </div>
    </div>
  );
}
