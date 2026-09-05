import { Card, PageHeader, SectionTitle } from "./ui";

/**
 * A section that exists in the navigation before it exists as a feature.
 *
 * PRD §7 permits this only when the placeholder is intentional rather than a broken page, so
 * each one states what it will hold, what it will be built from, and what has to land first.
 * That is the difference between showing the shape of the product and showing a dead link.
 */
export function Planned({
  title,
  tagline,
  purpose,
  contents,
  blockedBy,
}: {
  title: string;
  tagline: string;
  purpose: string;
  contents: { heading: string; detail: string }[];
  blockedBy: string;
}) {
  return (
    <div className="max-w-3xl">
      <PageHeader title={title} subtitle={tagline} />

      <Card className="mb-6 px-5 py-5">
        <div className="mb-3 inline-flex items-center gap-2 rounded-md bg-warn-soft px-2 py-1 text-[11px] font-medium text-warn">
          <span className="size-1.5 rounded-full bg-warn" aria-hidden />
          Planned — Phase 1
        </div>
        <p className="text-sm leading-relaxed text-ink-dim">{purpose}</p>
      </Card>

      <SectionTitle>What this will hold</SectionTitle>
      <ul className="mb-6 space-y-2">
        {contents.map((item) => (
          <Card as="li" key={item.heading} className="px-4 py-3">
            <p className="text-[14px] font-medium text-ink">{item.heading}</p>
            <p className="mt-0.5 text-[13px] leading-relaxed text-ink-dim">{item.detail}</p>
          </Card>
        ))}
      </ul>

      <Card className="border-dashed px-4 py-3.5">
        <p className="text-xs leading-relaxed text-ink-faint">
          <span className="font-medium text-ink-dim">Not started yet.</span> {blockedBy}
        </p>
      </Card>
    </div>
  );
}
