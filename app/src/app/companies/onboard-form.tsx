"use client";

import { useState, useTransition } from "react";

import { Button, cx } from "@/components/ui";
import { addCompany } from "./actions";

const inputStyles =
  "rounded-control border border-line bg-canvas px-2.5 py-1.5 text-body text-ink placeholder:text-ink-faint focus:border-line-strong focus:outline-none";

type Preview = {
  detection: { sourceType: string; sourceTier: number; label: string } | null;
  ok: boolean;
  total: number | null;
  sample: string[];
  error: string | null;
};

/**
 * Onboarding in one screen: the company, how to crawl it, and the person who can refer you.
 *
 * The check button is the point of the form. Detection is pure regex, so it will happily accept
 * `boards.greenhouse.io/ripling` — a typo that looks identical to a working board until the
 * first crawl returns nothing and nobody notices. Fetching the board once before saving turns
 * that silent failure into a visible one, which is the whole argument of this project applied
 * to its own data entry.
 */
export function OnboardForm() {
  const [careersUrl, setCareersUrl] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [checking, startCheck] = useTransition();
  const [saving, startSave] = useTransition();

  function check() {
    if (!careersUrl.trim()) return;
    startCheck(async () => {
      try {
        const response = await fetch("/api/companies/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ careersUrl }),
        });
        setPreview(await response.json());
      } catch {
        setPreview({
          detection: null,
          ok: false,
          total: null,
          sample: [],
          error: "Could not reach the preview endpoint.",
        });
      }
    });
  }

  const tone = !preview
    ? null
    : preview.ok
      ? { border: "border-fresh/40", bg: "bg-fresh-soft/40", text: "text-fresh" }
      : preview.detection
        ? { border: "border-warn/40", bg: "bg-warn-soft/40", text: "text-warn" }
        : { border: "border-line", bg: "bg-surface-2", text: "text-ink-dim" };

  return (
    <form
      action={(data) => startSave(async () => {
        await addCompany(data);
        setCareersUrl("");
        setPreview(null);
      })}
      className="space-y-3"
    >
      <div className="flex flex-wrap gap-2">
        <input
          name="name"
          placeholder="Company name"
          required
          className={cx(inputStyles, "w-48")}
        />
        <input
          name="careersUrl"
          value={careersUrl}
          onChange={(e) => {
            setCareersUrl(e.target.value);
            setPreview(null);
          }}
          placeholder="https://boards.greenhouse.io/…"
          className={cx(inputStyles, "min-w-64 flex-1")}
        />
        <Button
          type="button"
          onClick={check}
          disabled={checking || !careersUrl.trim()}
        >
          {checking ? "Checking…" : "Check source"}
        </Button>
      </div>

      {/* Referral contact, captured here rather than on a second trip through the company page:
          the contact is usually the reason the company is on the list at all. */}
      <div className="flex flex-wrap gap-2">
        <input name="contactName" placeholder="Referral contact (optional)" className={cx(inputStyles, "w-48")} />
        <input name="contactPhone" placeholder="Phone" className={cx(inputStyles, "w-40")} />
        <input name="contactLinkedin" placeholder="LinkedIn URL" className={cx(inputStyles, "min-w-48 flex-1")} />
        <input name="contactEmail" placeholder="Email" type="email" className={cx(inputStyles, "w-52")} />
      </div>

      {/* Optional at onboarding, editable later on the company page. Worth offering here
          because the moment you add a company is when you know its ladder. */}
      <input
        name="levelTitles"
        placeholder="Level titles at this company, comma separated (optional) — e.g. Senior Software Engineer"
        className={cx(inputStyles, "w-full")}
      />

      {preview && tone && (
        <div className={cx("rounded-control border px-3 py-2.5 text-meta", tone.border, tone.bg)}>
          <p className={cx("font-medium", tone.text)}>
            {preview.ok
              ? `${preview.detection?.label} — tier ${preview.detection?.sourceTier}, ${preview.total ?? preview.sample.length} jobs found`
              : preview.detection
                ? `${preview.detection.label} detected, but not proven`
                : "Not a recognised ATS"}
          </p>
          {preview.error && (
            <p className="mt-1 leading-relaxed text-ink-dim">{preview.error}</p>
          )}
          {preview.sample.length > 0 && (
            <ul className="mt-1.5 space-y-0.5 text-ink-dim">
              {preview.sample.map((title) => (
                <li key={title} className="truncate">
                  · {title}
                </li>
              ))}
            </ul>
          )}
          {preview.ok && (
            <p className="mt-1.5 text-ink-faint">
              It will be crawled on the next scheduled run — no deploy needed.
            </p>
          )}
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" disabled={saving}>
          {saving ? "Adding…" : "Add company"}
        </Button>
        <span className="text-label text-ink-faint">
          Checking is optional — an unrecognised URL is saved as a manual check with a link,
          never guessed at.
        </span>
      </div>
    </form>
  );
}
