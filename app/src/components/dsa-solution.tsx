import { Markdown } from "./markdown";
import { SolutionCode } from "./solution-code";
import { Badge, Card, cx, type Tone } from "./ui";
import type { CodeFile } from "./code-workspace";
import type { PrepContent } from "@/db/schema";

/**
 * A fully worked DSA answer: problem, then either brute-force + optimized or N genuinely
 * different approaches, each with its own code and complexity.
 *
 * Pulled out of the catch-all prep route because this template has real structure of its own --
 * chapters, per-solution cards, a complexity comparison -- that doesn't belong mixed into a page
 * component that also renders folders, books and the generic document body.
 */

/** A top-level chapter: Problem Summary, Example, Complexity at a Glance, Comparison Notes,
 *  Interview Notes. A rule underneath is what makes these read as the page's actual structure
 *  instead of one more heading buried in the prose beneath them. */
function DsaHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 mt-10 border-b border-line pb-2 text-[21px] font-bold text-ink first:mt-0">
      {children}
    </h2>
  );
}

/** "Intuition" / "Working Steps" -- a real sub-heading, not just a slightly bolder sentence: a
 *  colored rule to anchor the eye plus enough size and contrast to actually register as a label
 *  before the paragraph beneath it, deliberately still one step down from a chapter's DsaHeading. */
function DsaEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 mt-5 border-l-2 border-accent pl-2.5 text-[14px] font-bold uppercase tracking-[0.04em] text-ink first:mt-0">
      {children}
    </h3>
  );
}

/** The first balanced `O(...)` at or after `from`, with correct paren nesting
 *  (`O(K × min(P, Q))`) -- a plain "match up to the next )" regex breaks on exactly this shape,
 *  which shows up constantly once a bound is expressed in terms of more than one variable. */
function firstBigO(text: string, from: number): string | null {
  const start = text.indexOf("O(", from);
  if (start === -1) return null;
  let depth = 0;
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * The headline Big-O of a complexity explanation. Authors consistently bold the actual answer
 * (`**Time: O(n x target)**`) while an incidental per-step cost mentioned along the way stays
 * plain (`...each does O(1) work apart from its recursive calls.`) -- so the first *bolded*
 * `O(...)` is the real headline, not just the first one that appears in reading order. Falls
 * back to the first occurrence anywhere only when nothing in the text is bolded at all.
 */
function headlineComplexity(text: string | undefined): string | null {
  if (!text) return null;
  for (const bold of text.matchAll(/\*\*([\s\S]+?)\*\*/g)) {
    const hit = firstBigO(bold[1], 0);
    if (hit) return hit;
  }
  return firstBigO(text, 0);
}

/** One complexity fact: a scannable Big-O headline first, the full reasoning underneath --
 *  never just a bare bound, since "why" is what actually gets recalled in an interview. */
function ComplexityFact({ label, text }: { label: string; text: string }) {
  const headline = headlineComplexity(text);
  return (
    <div className="rounded-card border border-line bg-surface-2 px-3.5 py-3">
      <p className="text-[11.5px] font-bold uppercase tracking-[0.05em] text-ink-dim">{label}</p>
      {headline && <p className="mt-1 font-mono text-[18px] font-bold text-ink">{headline}</p>}
      <div className={cx(headline ? "mt-1.5" : "mt-1", "[&_p]:my-0")}>
        <Markdown tone="ink">{text}</Markdown>
      </div>
    </div>
  );
}

type ComparisonRow = { label: string; tone: Tone; time?: string; space?: string };

/** The comparison the user has to build by re-reading every section otherwise: every approach's
 *  Big-O side by side. Generated from the same structured fields the detailed sections already
 *  use, so it appears on every worked answer without needing a hand-written table too. */
function ComparisonTable({ rows }: { rows: ComparisonRow[] }) {
  if (rows.length < 2) return null;
  return (
    <>
      <DsaHeading>Complexity at a Glance</DsaHeading>
      <div className="overflow-x-auto rounded-card border border-line">
        <table className="w-full border-collapse text-left text-[14px]">
          <thead className="bg-surface-2">
            <tr>
              <th className="px-3 py-2 font-medium text-ink">Approach</th>
              <th className="px-3 py-2 font-medium text-ink">Time</th>
              <th className="px-3 py-2 font-medium text-ink">Space</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-t border-line">
                <td className="px-3 py-2.5 align-top">
                  <Badge tone={r.tone}>{r.label}</Badge>
                </td>
                <td className="px-3 py-2.5 align-top font-mono text-[14px] font-semibold text-ink">
                  {headlineComplexity(r.time) ?? "—"}
                </td>
                <td className="px-3 py-2.5 align-top font-mono text-[14px] font-semibold text-ink">
                  {headlineComplexity(r.space) ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** One worked solution: intuition, steps, code, then its two complexity facts -- self-contained
 *  in a card so "Brute Force" and "Optimized" read as two distinct, comparable answers rather
 *  than one long scroll of prose with headings sprinkled through it. */
function SolutionBlock({
  tag,
  tone,
  title,
  intuition,
  steps,
  timeComplexity,
  spaceComplexity,
  file,
}: {
  tag?: string;
  tone: Tone;
  title: string;
  intuition: string;
  steps: string;
  timeComplexity?: string;
  spaceComplexity?: string;
  file: CodeFile | undefined;
}) {
  return (
    <Card className="mb-8 px-5 py-5">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {tag && <Badge tone={tone}>{tag}</Badge>}
        <h2 className="text-[18px] font-bold text-ink">{title}</h2>
      </div>

      <DsaEyebrow>Intuition</DsaEyebrow>
      <Markdown size="md" tone="ink">{intuition}</Markdown>

      <DsaEyebrow>Working Steps</DsaEyebrow>
      <div className="step-list">
        <Markdown size="md" tone="ink">{steps}</Markdown>
      </div>

      <div className="mt-3">
        <SolutionCode file={file} />
      </div>

      {(timeComplexity || spaceComplexity) && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {timeComplexity && <ComplexityFact label="Time Complexity" text={timeComplexity} />}
          {spaceComplexity && <ComplexityFact label="Space Complexity" text={spaceComplexity} />}
        </div>
      )}
    </Card>
  );
}

export function DsaSolution({
  content,
  codeFiles,
}: {
  content: PrepContent;
  codeFiles: CodeFile[];
}) {
  const bruteForceFile = codeFiles.find((f) => f.path === "brute_force.cpp");
  const optimizedFile = codeFiles.find((f) => f.path === "optimized.cpp");
  const approaches = content.approaches ?? [];
  const hasApproaches = approaches.length > 0;
  const hasBruteForce = Boolean(content.bruteForceIntuition);

  const comparisonRows: ComparisonRow[] = hasApproaches
    ? approaches.map((a) => ({
        label: a.title,
        tone: "neutral",
        time: a.timeComplexity,
        space: a.spaceComplexity,
      }))
    : [
        ...(hasBruteForce
          ? [
              {
                label: "Brute Force",
                tone: "neutral" as const,
                time: content.bruteForceTimeComplexity,
                space: content.bruteForceSpaceComplexity,
              },
            ]
          : []),
        {
          label: "Optimized",
          tone: "fresh",
          time: content.optimizedTimeComplexity,
          space: content.optimizedSpaceComplexity,
        },
      ];

  return (
    <div className="mb-6">
      <DsaHeading>Problem Summary</DsaHeading>
      <Markdown size="md" tone="ink">{content.problemSummary ?? ""}</Markdown>

      {content.examples && (
        <>
          <DsaHeading>Example</DsaHeading>
          <Markdown size="md" tone="ink">{content.examples}</Markdown>
        </>
      )}

      <ComparisonTable rows={comparisonRows} />

      {hasApproaches ? (
        approaches.map((approach, i) => (
          <SolutionBlock
            key={i}
            tag={`Approach ${i + 1}`}
            tone="neutral"
            title={approach.title.replace(/^approach\s*\d+\s*:\s*/i, "") || approach.title}
            intuition={approach.intuition}
            steps={approach.steps}
            timeComplexity={approach.timeComplexity}
            spaceComplexity={approach.spaceComplexity}
            file={codeFiles.find((f) => f.path === approach.codeFile)}
          />
        ))
      ) : (
        <>
          {hasBruteForce && (
            <SolutionBlock
              tag="Brute Force"
              tone="neutral"
              title="Brute Force"
              intuition={content.bruteForceIntuition ?? ""}
              steps={content.bruteForceSteps ?? ""}
              timeComplexity={content.bruteForceTimeComplexity}
              spaceComplexity={content.bruteForceSpaceComplexity}
              file={bruteForceFile}
            />
          )}
          <SolutionBlock
            tag="Optimized"
            tone="fresh"
            title="Optimized Solution"
            intuition={content.optimizedIntuition ?? ""}
            steps={content.optimizedSteps ?? ""}
            timeComplexity={content.optimizedTimeComplexity}
            spaceComplexity={content.optimizedSpaceComplexity}
            file={optimizedFile}
          />
        </>
      )}

      {content.comparisonTable && (
        <>
          <DsaHeading>Comparison Notes</DsaHeading>
          <Markdown size="md" tone="ink">{content.comparisonTable}</Markdown>
        </>
      )}

      {content.interviewNotes && (
        <>
          <DsaHeading>What to Say in the Interview</DsaHeading>
          <Markdown size="md" tone="ink">{content.interviewNotes}</Markdown>
        </>
      )}
    </div>
  );
}
