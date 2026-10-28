import Link from "next/link";

import { HrCallActions } from "@/components/hr-call";
import { Badge, Card, EmptyState, PageHeader, SectionTitle, cx } from "@/components/ui";
import { getDb } from "@/db";
import { STAGE_LABEL } from "@/server/domain/applications";
import { BAND_LABEL } from "@/server/domain/fit";
import { ago, buildHrList, type HrEntry, type HrState } from "@/server/domain/hr";
import { toE164, whatsappLink } from "@/server/domain/templates";
import { listHrCompanies, listHrOpenings } from "@/server/repository/hr-repo";

export const dynamic = "force-dynamic";

const SECTIONS: { state: HrState; title: string }[] = [
  { state: "call", title: "Call now" },
  { state: "untracked", title: "Not crawled — ask what is open" },
  { state: "called", title: "Already called" },
  { state: "quiet", title: "No relevant openings" },
];

/**
 * The opening line, written for the role that prompted the call. A recruiter is far more
 * likely to act on "I saw you opened X" than on "anything for me?", and it is the one detail
 * the board knows that a blank message would not.
 */
function opener(entry: HrEntry, contactName: string): string {
  const greet = /\bHR$/.test(contactName) ? "Hi" : `Hi ${contactName}`;
  const role = entry.fresh[0] ?? entry.openings[0];
  const ask = role
    ? `I saw ${entry.company.name} has opened a ${role.title} role` +
      (role.location ? ` in ${role.location}` : "") +
      " and would love to be considered."
    : `I'd love to know if ${entry.company.name} has any SDE-2 / backend openings coming up.`;
  return `${greet}, this is Sarthak — ex-Uber backend engineer. ${ask} Could you help me with the next step?`;
}

export default async function HrPage() {
  const db = getDb();
  const companies = await listHrCompanies(db);
  const openings = await listHrOpenings(
    db,
    companies.map((c) => c.id),
  );
  const now = new Date();
  const entries = buildHrList(companies, openings, now);

  const toCall = entries.filter((e) => e.state === "call");
  const contacts = companies.reduce((n, c) => n + c.contacts.length, 0);

  return (
    <div>
      <PageHeader
        title="HR contacts"
        subtitle={
          <>
            <span className="tnum text-ink">{contacts}</span> recruiters at{" "}
            <span className="tnum text-ink">{companies.length}</span> companies
            {toCall.length > 0 && (
              <>
                {" · "}
                <span className="tnum text-warn">{toCall.length}</span> worth a call now
              </>
            )}
          </>
        }
      />

      {entries.length === 0 ? (
        <EmptyState
          title="No HR contacts yet"
          body="Mark a contact as HR on its company page and it appears here, with a prompt whenever that company opens a relevant role."
        />
      ) : (
        SECTIONS.map(({ state, title }) => {
          const list = entries.filter((e) => e.state === state);
          if (list.length === 0) return null;
          return (
            <section key={state} className="mb-7">
              <SectionTitle>
                {title} · {list.length}
              </SectionTitle>
              <ul className="space-y-2">
                {list.map((e) => (
                  <HrRow key={e.company.id} entry={e} now={now} />
                ))}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}

function HrRow({ entry: e, now }: { entry: HrEntry; now: Date }) {
  const calling = e.state === "call";
  // On a call row, the openings that prompted it; elsewhere, whatever is open, for context.
  const shown = calling ? e.fresh : e.openings;

  return (
    <Card
      as="li"
      className={cx("px-4 py-3.5", calling && (e.hot ? "border-warn/50" : "border-accent/40"))}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/companies/${e.company.id}`}
              className="text-[14px] font-semibold text-ink underline-offset-2 hover:underline"
            >
              {e.company.name}
            </Link>
            {calling && e.hot && <Badge tone="warn">New this week</Badge>}
            {e.state === "untracked" && <Badge>Manual check</Badge>}
          </div>
          <p className={cx("mt-0.5 text-[13px]", calling ? "font-medium text-ink" : "text-ink-dim")}>
            {e.headline}
          </p>
          <p className="mt-0.5 text-[12px] text-ink-faint">{e.detail}</p>
        </div>
        {e.company.careersUrl && (
          <a
            href={e.company.careersUrl}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 text-[12px] text-ink-faint underline-offset-2 hover:text-ink-dim hover:underline"
          >
            Careers page ↗
          </a>
        )}
      </div>

      {shown.length > 0 && (
        <ul className="mt-2.5 space-y-1 border-l-2 border-line pl-3">
          {shown.slice(0, 5).map((o) => (
            <li key={o.jobId} className="flex flex-wrap items-baseline gap-x-2 text-[12.5px]">
              <Link
                href={`/jobs/${o.jobId}`}
                className="text-ink underline-offset-2 hover:underline"
              >
                {o.title}
              </Link>
              {o.location && <span className="text-ink-faint">{o.location}</span>}
              {o.fitBand && (
                <span className="text-[11px] text-ink-dim">{BAND_LABEL[o.fitBand]}</span>
              )}
              {o.status && <Badge tone="accent">{STAGE_LABEL[o.status]}</Badge>}
              <span className="text-[11px] text-ink-faint">found {ago(o.discoveredAt, now)}</span>
            </li>
          ))}
          {shown.length > 5 && (
            <li className="text-[11px] text-ink-faint">
              +{shown.length - 5} more on the{" "}
              <Link href={`/companies/${e.company.id}`} className="underline underline-offset-2">
                company page
              </Link>
            </li>
          )}
        </ul>
      )}

      <ul className="mt-3 space-y-2 border-t border-line/60 pt-2.5">
        {e.company.contacts.map((c) => {
          const tel = toE164(c.phone);
          return (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0 text-[12.5px]">
                <span className="font-medium text-ink">{c.name}</span>
                {c.phone && <span className="tnum ml-2 text-ink-dim">{c.phone}</span>}
                <span className="ml-2 text-[11px] text-ink-faint">
                  {c.lastCalledAt ? `called ${ago(c.lastCalledAt, now)}` : "never called"}
                </span>
                {c.notes && <p className="text-[11px] text-ink-faint">{c.notes}</p>}
              </div>
              <HrCallActions
                contactId={c.id}
                name={/\bHR$/.test(c.name) ? "HR" : c.name}
                tel={tel}
                whatsapp={whatsappLink(c.phone, opener(e, c.name))}
                lastCalledMs={c.lastCalledAt ? c.lastCalledAt.getTime() : null}
                primary={calling && e.primary?.id === c.id}
              />
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
