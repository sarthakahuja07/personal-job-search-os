/**
 * The shape of a published LLD solution.
 *
 * A low-level design answer has a structure that barely varies: what is being asked, what it
 * must do, the things, how they relate, the seams, why each seam was cut where it was, and what
 * breaks at the edges. Written freehand by a different assistant each time, that structure comes
 * out in a different order with different headings, and a set of pages you cannot skim is a set
 * of pages you do not revise from.
 *
 * So the caller sends named sections and the server composes the Markdown. The alternative --
 * asking each assistant to format the page itself and trusting it -- puts the layout decision in
 * the one place we have least control over, and makes "why does this page look different" a
 * question about a prompt rather than about code. Business logic belongs on the server; this is
 * business logic about what a study page *is*.
 *
 * The code is deliberately not part of the body. It lives in `prep_code_files` and renders in
 * the editor-like Code section, where it can be browsed file by file with highlighting -- a
 * twelve-file Go module pasted into Markdown is a wall you scroll past, not something you read.
 */

export type DesignChoice = {
  /** Which part of the design this row is about, e.g. "Bay allocation". */
  component: string;
  /** What was decided. */
  choice: string;
  /** The principle or pattern it follows, e.g. "Strategy", "OCP". */
  principle?: string | null;
  /** Why it was decided that way. */
  why?: string | null;
};

export type LldSolution = {
  problem_statement?: string | null;
  requirements?: string | null;
  entities?: string | null;
  relationships?: string | null;
  interfaces?: string | null;
  design_choices?: DesignChoice[] | null;
  edge_cases?: string | null;
};

/**
 * The section order, fixed.
 *
 * It is the order the design is actually derived in -- you cannot name entities before you have
 * requirements, or justify a pattern before the interfaces exist -- so a page read top to bottom
 * reproduces the reasoning rather than just listing its conclusions.
 */
export const LLD_SECTIONS = [
  { key: "problem_statement", heading: "Problem statement" },
  { key: "requirements", heading: "Requirements" },
  { key: "entities", heading: "Entities" },
  { key: "relationships", heading: "Relationships and diagrams" },
  { key: "interfaces", heading: "Interfaces" },
  { key: "design_choices", heading: "Design choices and principles" },
  { key: "edge_cases", heading: "Cases handled and edge cases" },
] as const satisfies ReadonlyArray<{ key: keyof LldSolution; heading: string }>;

/**
 * Make one cell safe to put in a Markdown table.
 *
 * A bare `|` ends the cell and silently shifts every column after it, which is the failure mode
 * where the table still renders -- just wrongly -- so nobody notices. A newline ends the row
 * outright, and `design_choices` rows routinely carry a sentence with a line break in it.
 */
export function escapeTableCell(value: string): string {
  return value
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, "<br>")
    .trim();
}

/** The design-choices table, or null when there are no rows to put in it. */
export function renderDesignChoices(rows: readonly DesignChoice[]): string | null {
  const usable = rows.filter((r) => r.component?.trim() || r.choice?.trim());
  if (usable.length === 0) return null;

  // Only include the optional columns that some row actually fills, so a table without a stated
  // principle does not carry an empty column down its whole length.
  const hasPrinciple = usable.some((r) => r.principle?.trim());
  const hasWhy = usable.some((r) => r.why?.trim());

  const headers = ["Component", "Choice"];
  if (hasPrinciple) headers.push("Principle / pattern");
  if (hasWhy) headers.push("Why");

  const lines = [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
  ];

  for (const row of usable) {
    const cells = [escapeTableCell(row.component ?? ""), escapeTableCell(row.choice ?? "")];
    if (hasPrinciple) cells.push(escapeTableCell(row.principle ?? ""));
    if (hasWhy) cells.push(escapeTableCell(row.why ?? ""));
    lines.push(`| ${cells.join(" | ")} |`);
  }

  return lines.join("\n");
}

/** True when a solution payload carries nothing worth composing. */
export function isEmptyLldSolution(solution: LldSolution): boolean {
  return composeLldBody(solution) === null;
}

/**
 * Compose the page body from the named sections.
 *
 * Absent sections are skipped rather than rendered as an empty heading: a page that says
 * "## Interfaces" with nothing under it reads as though the answer is missing, when usually the
 * question simply had no interfaces worth naming.
 *
 * Returns null when nothing was supplied, so the caller can fall back to a plain `body` instead
 * of writing an empty document over one that already exists.
 */
export function composeLldBody(solution: LldSolution): string | null {
  const blocks: string[] = [];

  for (const section of LLD_SECTIONS) {
    if (section.key === "design_choices") {
      const table = renderDesignChoices(solution.design_choices ?? []);
      if (table) blocks.push(`## ${section.heading}\n\n${table}`);
      continue;
    }

    const value = solution[section.key];
    if (typeof value === "string" && value.trim()) {
      blocks.push(`## ${section.heading}\n\n${value.trim()}`);
    }
  }

  return blocks.length ? blocks.join("\n\n") + "\n" : null;
}
