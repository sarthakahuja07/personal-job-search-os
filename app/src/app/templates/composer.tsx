"use client";

import { useMemo, useState } from "react";

import { Card, cx, inputStyles } from "@/components/ui";
import {
  KNOWN_VARIABLES,
  extractVariables,
  mailtoLink,
  missingVariables,
  renderTemplate,
  whatsappLink,
} from "@/server/domain/templates";

export type TemplateOption = { id: string; name: string; body: string };

export type ContactOption = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  companyName: string;
};

/**
 * Select a template, fill what the app does not already know, send.
 *
 * Everything derivable is pre-filled -- role, company and link from the job you came from, the
 * resume link from Settings, the contact's name when you pick one. The remaining fields are the
 * only ones worth typing, and the rendered message stays editable to the end: the aim is to
 * remove retyping, not to automate the asking (PRD §99).
 */
export function Composer({
  templates,
  contacts,
  defaults,
}: {
  templates: TemplateOption[];
  contacts: ContactOption[];
  defaults: Record<string, string>;
}) {
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [contactId, setContactId] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [edited, setEdited] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const template = templates.find((t) => t.id === templateId) ?? templates[0];
  const contact = contacts.find((c) => c.id === contactId);

  // Precedence: what you typed > the contact you picked > defaults from the job and settings.
  const resolved = useMemo(() => {
    const base: Record<string, string> = { ...defaults };
    if (contact) {
      base.name = contact.name;
      base.company = base.company || contact.companyName;
    }
    return { ...base, ...values };
  }, [defaults, contact, values]);

  const variables = template ? extractVariables(template.body) : [];
  const rendered = template ? renderTemplate(template.body, resolved) : "";
  const missing = template ? missingVariables(template.body, resolved) : [];
  const message = edited ?? rendered;

  // Re-rendering the template must not silently discard a message you have hand-edited, so the
  // edit is kept until you explicitly reset it.
  const isEdited = edited !== null && edited !== rendered;

  const wa = whatsappLink(contact?.phone, message);
  const mail = mailtoLink(
    contact?.email,
    `Referral request — ${resolved.role ?? "role"} at ${resolved.company ?? ""}`.trim(),
    message,
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard can be blocked; the textarea is selectable as a fallback.
      setCopied(false);
    }
  }

  if (!template) return null;

  return (
    <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
      <div className="space-y-3">
        <Card className="px-4 py-4">
          <label htmlFor="template" className="block text-body font-medium text-ink">
            Template
          </label>
          <select
            id="template"
            value={templateId}
            onChange={(e) => {
              setTemplateId(e.target.value);
              setEdited(null);
            }}
            className={cx(inputStyles, "mt-1.5")}
          >
            {templates.map((t) => (
              <option key={t.id} value={t.id} className="bg-surface-2">
                {t.name}
              </option>
            ))}
          </select>

          {contacts.length > 0 && (
            <>
              <label htmlFor="contact" className="mt-4 block text-body font-medium text-ink">
                Contact
              </label>
              <select
                id="contact"
                value={contactId}
                onChange={(e) => {
                  setContactId(e.target.value);
                  setEdited(null);
                }}
                className={cx(inputStyles, "mt-1.5")}
              >
                <option value="" className="bg-surface-2">
                  — none —
                </option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id} className="bg-surface-2">
                    {c.name} · {c.companyName}
                  </option>
                ))}
              </select>
            </>
          )}
        </Card>

        <Card className="space-y-3 px-4 py-4">
          <p className="text-label uppercase tracking-wide text-ink-faint">Fill in</p>
          {variables.map((v) => {
            const meta = KNOWN_VARIABLES[v];
            const isMissing = missing.includes(v);
            return (
              <div key={v}>
                <label
                  htmlFor={`var-${v}`}
                  className="flex items-baseline justify-between text-meta font-medium text-ink"
                >
                  {meta?.label ?? v}
                  {isMissing && <span className="text-label text-warn">needed</span>}
                </label>
                <input
                  id={`var-${v}`}
                  value={values[v] ?? resolved[v] ?? ""}
                  onChange={(e) => {
                    setValues((s) => ({ ...s, [v]: e.target.value }));
                    setEdited(null);
                  }}
                  placeholder={meta?.hint ?? v}
                  className={cx(
                    inputStyles,
                    "mt-1 text-body",
                    isMissing && "border-warn/60",
                  )}
                />
              </div>
            );
          })}
          {variables.length === 0 && (
            <p className="text-meta text-ink-faint">
              This template has no variables — it is ready to copy.
            </p>
          )}
        </Card>
      </div>

      <Card className="flex flex-col px-4 py-4">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-label uppercase tracking-wide text-ink-faint">
            Message
            {isEdited && <span className="ml-2 text-ink">edited</span>}
          </p>
          {isEdited && (
            <button
              type="button"
              onClick={() => setEdited(null)}
              className="text-label text-ink-faint transition hover:text-ink-dim"
            >
              Reset to template
            </button>
          )}
        </div>

        <textarea
          value={message}
          onChange={(e) => setEdited(e.target.value)}
          rows={16}
          className={cx(inputStyles, "flex-1 resize-y leading-relaxed")}
        />

        {missing.length > 0 && (
          <p className="mt-2 text-label text-warn">
            Still unfilled: {missing.map((m) => KNOWN_VARIABLES[m]?.label ?? m).join(", ")}.
            The placeholder is left visible rather than blanked, so nothing goes out half-written.
          </p>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={copy}
            className="rounded-control bg-accent px-3 py-1.5 text-body font-medium text-canvas transition hover:brightness-110"
          >
            {copied ? "Copied" : "Copy message"}
          </button>
          {wa && (
            <a
              href={wa}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-control border border-line bg-surface-2 px-3 py-1.5 text-body text-ink-dim transition hover:border-line-strong hover:text-ink"
            >
              Open WhatsApp
            </a>
          )}
          {mail && (
            <a
              href={mail}
              className="rounded-control border border-line bg-surface-2 px-3 py-1.5 text-body text-ink-dim transition hover:border-line-strong hover:text-ink"
            >
              Open email
            </a>
          )}
          {contact && !wa && !mail && (
            <span className="self-center text-label text-ink-faint">
              {contact.name} has no usable phone or email on file.
            </span>
          )}
        </div>
      </Card>
    </div>
  );
}
