"use client";

import { useEffect, useMemo, useState } from "react";

import { cx } from "./ui";
import {
  linkedinLink,
  mailtoLink,
  renderTemplate,
  whatsappLink,
} from "@/server/domain/templates";

export type OutreachContact = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  linkedinUrl: string | null;
};

export type OutreachTemplate = { id: string; name: string; body: string };

export type Outreach = {
  contacts: OutreachContact[];
  templates: OutreachTemplate[];
  /** resume_link and your_name from Settings; everything else is derived from the job. */
  defaults: Record<string, string>;
};

export type JobActionsProps = {
  jobTitle: string;
  jobUrl: string;
  companyName: string;
  companyId: string;
  /**
   * Only the count travels with the card. The payload itself is fetched when the modal opens:
   * because the modal is a client component, passing it as props serialised every contact and
   * every template body once per card — 200 copies on a full board, which is what made the job
   * page a 1.8 MB response.
   */
  contactCount: number;
};

const btn =
  "inline-flex items-center gap-1 rounded-control border px-2 py-1 text-label font-medium transition";

/**
 * The two things you actually do with a job: apply, or ask someone for a referral.
 *
 * Both were previously several clicks away — open the job, find the company, find the contact,
 * open Templates, re-pick the job. The message modal collapses that into one step, and does not
 * try to be clever: it renders a template, leaves it editable, and hands it to whichever channel
 * the contact can actually be reached on.
 */
export function JobActions({
  jobTitle,
  jobUrl,
  companyName,
  companyId,
  contactCount,
}: JobActionsProps) {
  const [open, setOpen] = useState(false);
  const [outreach, setOutreach] = useState<Outreach | null>(null);
  const [loading, setLoading] = useState(false);

  async function openModal() {
    setOpen(true);
    if (outreach) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/companies/${companyId}/outreach`);
      setOutreach(await r.json());
    } catch {
      setOutreach({ contacts: [], templates: [], defaults: {} });
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <a
        href={jobUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={cx(btn, "border-line bg-surface-2 text-ink-dim hover:border-line-strong hover:text-ink")}
      >
        Apply ↗
      </a>
      <button
        type="button"
        onClick={openModal}
        disabled={contactCount === 0}
        title={
          contactCount === 0
            ? `No referral contact saved for ${companyName}`
            : `Message a contact at ${companyName}`
        }
        className={cx(
          btn,
          contactCount === 0
            ? "cursor-not-allowed border-line bg-surface-2 text-ink-faint/60"
            : "border-line-strong bg-accent-soft text-ink hover:border-line-strong",
        )}
      >
        Message{contactCount > 1 ? ` (${contactCount})` : ""}
      </button>

      {open && (
        <OutreachModal
          onClose={() => setOpen(false)}
          jobTitle={jobTitle}
          jobUrl={jobUrl}
          companyName={companyName}
          loading={loading}
          contacts={outreach?.contacts ?? []}
          templates={outreach?.templates ?? []}
          defaults={outreach?.defaults ?? {}}
        />
      )}
    </>
  );
}

function OutreachModal({
  onClose,
  jobTitle,
  jobUrl,
  companyName,
  contacts,
  templates,
  defaults,
  loading,
}: Outreach & {
  onClose: () => void;
  jobTitle: string;
  jobUrl: string;
  companyName: string;
  loading: boolean;
}) {
  const [contactId, setContactId] = useState(contacts[0]?.id ?? "");
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [edited, setEdited] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const contact = contacts.find((c) => c.id === contactId) ?? contacts[0];
  const template = templates.find((t) => t.id === templateId) ?? templates[0];

  const rendered = useMemo(() => {
    if (!template) return "";
    return renderTemplate(template.body, {
      ...defaults,
      name: contact?.name ?? "",
      company: companyName,
      role: jobTitle,
      job_link: jobUrl,
    });
  }, [template, defaults, contact, companyName, jobTitle, jobUrl]);

  // A hand-edited message must survive switching contact or template; it is only discarded when
  // you say so. Losing typed text to a dropdown is the fastest way to make a tool untrusted.
  const message = edited ?? rendered;

  const wa = whatsappLink(contact?.phone, message);
  const mail = mailtoLink(
    contact?.email,
    `Referral request — ${jobTitle} at ${companyName}`,
    message,
  );
  const li = linkedinLink(contact?.linkedinUrl);

  async function copy() {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-[8vh]"
      role="dialog"
      aria-modal="true"
      aria-label={`Message a contact at ${companyName}`}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-xl rounded-card border border-line bg-surface shadow-overlay">
        <div className="flex items-start justify-between gap-4 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-section font-medium text-ink">{jobTitle}</p>
            <p className="text-meta text-ink-dim">{companyName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-control px-1.5 text-section leading-none text-ink-faint transition hover:text-ink"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {loading && (
          <p className="px-4 py-6 text-center text-meta text-ink-faint">Loading…</p>
        )}

        <div className={cx("space-y-3 px-4 py-3.5", loading && "hidden")}>
          <div>
            <p className="mb-1.5 text-label font-medium uppercase tracking-wide text-ink-faint">
              Contact
            </p>
            <div className="flex flex-wrap gap-1.5">
              {contacts.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setContactId(c.id)}
                  className={cx(
                    "rounded-control border px-2 py-1 text-meta transition",
                    c.id === contact?.id
                      ? "border-line-strong bg-surface-3 text-ink"
                      : "border-line bg-surface-2 text-ink-dim hover:text-ink",
                  )}
                >
                  {c.name}
                  {/* The destination itself, not just which channels exist. A stored number can
                      be wrong — one contact here was saved with another company's number, and
                      the only clue was WhatsApp opening under a different name. Showing where
                      the message is going makes that visible before you send it. */}
                  <span className="ml-1.5 text-label text-ink-faint">
                    {c.phone ?? c.email ?? (c.linkedinUrl ? "LinkedIn" : "no channel")}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-label font-medium uppercase tracking-wide text-ink-faint">
              Template
            </p>
            <div className="flex flex-wrap gap-1.5">
              {templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTemplateId(t.id)}
                  className={cx(
                    "rounded-control border px-2 py-1 text-meta transition",
                    t.id === template?.id
                      ? "border-line-strong bg-surface-3 text-ink"
                      : "border-line bg-surface-2 text-ink-dim hover:text-ink",
                  )}
                >
                  {t.name}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-label font-medium uppercase tracking-wide text-ink-faint">
                Message
              </p>
              {edited !== null && edited !== rendered && (
                <button
                  type="button"
                  onClick={() => setEdited(null)}
                  className="text-label text-ink-faint underline-offset-2 hover:text-ink-dim hover:underline"
                >
                  Reset to template
                </button>
              )}
            </div>
            <textarea
              value={message}
              onChange={(e) => setEdited(e.target.value)}
              rows={8}
              className="w-full rounded-control border border-line bg-canvas px-2.5 py-2 text-body leading-relaxed text-ink focus:border-line-strong focus:outline-none"
            />
          </div>
        </div>

        <div className={cx("flex flex-wrap items-center gap-2 border-t border-line px-4 py-3", loading && "hidden")}>
          {wa && (
            <a href={wa} target="_blank" rel="noopener noreferrer"
              className={cx(btn, "border-fresh/40 bg-fresh-soft text-fresh hover:border-fresh")}>
              WhatsApp ↗
            </a>
          )}
          {mail && (
            <a href={mail}
              className={cx(btn, "border-line-strong bg-accent-soft text-ink hover:border-line-strong")}>
              Email ↗
            </a>
          )}
          {li && (
            // LinkedIn has no public URL that opens a chat with body text, so the honest flow is
            // to copy the message and open the profile — never a button that silently drops it.
            <button
              type="button"
              onClick={async () => {
                await copy();
                window.open(li, "_blank", "noopener,noreferrer");
              }}
              className={cx(btn, "border-line bg-surface-2 text-ink-dim hover:border-line-strong hover:text-ink")}
            >
              LinkedIn ↗ (copies first)
            </button>
          )}
          <button type="button" onClick={copy}
            className={cx(btn, "border-line bg-surface-2 text-ink-dim hover:border-line-strong hover:text-ink")}>
            {copied ? "Copied" : "Copy"}
          </button>

          {!wa && !mail && !li && (
            <span className="text-label text-warn">
              {contact?.name} has no phone, email or LinkedIn saved — add one on the company page.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
