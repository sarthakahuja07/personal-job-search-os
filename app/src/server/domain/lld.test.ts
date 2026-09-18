import { describe, expect, it } from "vitest";

import {
  composeLldBody,
  escapeTableCell,
  isEmptyLldSolution,
  LLD_SECTIONS,
  renderDesignChoices,
} from "./lld";

describe("composeLldBody", () => {
  it("emits the sections in the fixed order, whatever order they arrive in", () => {
    const body = composeLldBody({
      edge_cases: "Double submit.",
      problem_statement: "Design a parking lot.",
      interfaces: "PricingStrategy.",
      requirements: "Multiple floors.",
    });

    const headings = (body ?? "").match(/^## .+$/gm);
    expect(headings).toEqual([
      "## Problem statement",
      "## Requirements",
      "## Interfaces",
      "## Cases handled and edge cases",
    ]);
  });

  it("skips sections that were not supplied rather than leaving empty headings", () => {
    const body = composeLldBody({ problem_statement: "Design a lift." }) ?? "";
    expect(body).toContain("## Problem statement");
    expect(body).not.toContain("## Entities");
  });

  it("treats whitespace-only sections as absent", () => {
    expect(composeLldBody({ problem_statement: "   \n  " })).toBeNull();
  });

  it("returns null for an empty payload, so it cannot blank an existing page", () => {
    expect(composeLldBody({})).toBeNull();
    expect(composeLldBody({ design_choices: [] })).toBeNull();
    expect(isEmptyLldSolution({})).toBe(true);
  });

  it("renders the design-choices table under its own heading", () => {
    const body = composeLldBody({
      design_choices: [
        { component: "Pricing", choice: "Strategy interface", principle: "OCP", why: "Rates change" },
      ],
    }) ?? "";

    expect(body).toContain("## Design choices and principles");
    expect(body).toContain("| Component | Choice | Principle / pattern | Why |");
    expect(body).toContain("| Pricing | Strategy interface | OCP | Rates change |");
  });

  it("keeps a mermaid fence intact, so the diagram still renders", () => {
    const chart = "```mermaid\nclassDiagram\n  Lot --> Floor\n```";
    expect(composeLldBody({ relationships: chart })).toContain(chart);
  });

  it("covers every declared section", () => {
    const full = composeLldBody({
      problem_statement: "a",
      requirements: "b",
      entities: "c",
      relationships: "d",
      interfaces: "e",
      design_choices: [{ component: "f", choice: "g" }],
      edge_cases: "h",
    }) ?? "";

    for (const section of LLD_SECTIONS) {
      expect(full).toContain(`## ${section.heading}`);
    }
  });
});

describe("renderDesignChoices", () => {
  it("omits optional columns no row fills", () => {
    const table = renderDesignChoices([{ component: "Bays", choice: "Smallest fit" }]) ?? "";
    expect(table).toContain("| Component | Choice |");
    expect(table).not.toContain("Principle");
    expect(table).not.toContain("Why");
  });

  it("includes an optional column when any row fills it", () => {
    const table = renderDesignChoices([
      { component: "Bays", choice: "Smallest fit" },
      { component: "Pricing", choice: "Strategy", principle: "OCP" },
    ]) ?? "";
    expect(table).toContain("| Component | Choice | Principle / pattern |");
    // The row that left it empty still has the cell, or the columns would shift.
    expect(table).toContain("| Bays | Smallest fit |  |");
  });

  it("drops rows that say nothing", () => {
    expect(renderDesignChoices([{ component: "  ", choice: "" }])).toBeNull();
    expect(renderDesignChoices([])).toBeNull();
  });

  it("has one separator row and one row per entry", () => {
    const lines = (renderDesignChoices([
      { component: "a", choice: "b" },
      { component: "c", choice: "d" },
    ]) ?? "").split("\n");
    expect(lines).toHaveLength(4); // header, separator, two rows
    expect(lines[1]).toMatch(/^\|( ---( \|)?)+$/);
  });
});

describe("escapeTableCell", () => {
  it("escapes a pipe, which would otherwise shift every later column", () => {
    expect(escapeTableCell("a | b")).toBe("a \\| b");
  });

  it("turns a newline into a break, which would otherwise end the row", () => {
    expect(escapeTableCell("one\ntwo")).toBe("one<br>two");
    expect(escapeTableCell("one\r\ntwo")).toBe("one<br>two");
  });

  it("keeps a whole row on one line even with both", () => {
    const cell = escapeTableCell("Strategy | Factory\nand State");
    expect(cell).not.toMatch(/\n/);
    expect(cell.split("\\|")).toHaveLength(2);
  });
});
