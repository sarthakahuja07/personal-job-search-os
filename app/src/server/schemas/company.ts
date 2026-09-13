import { z } from "zod";

import { DISCIPLINES } from "@/server/domain/company";

/** ISO date, so "last asked" sorts and compares rather than being prose. */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "last_asked must be an ISO date (YYYY-MM-DD)");

export const scaffoldSchema = z.object({
  name: z.string().min(1).max(120),
});

export const bankEntrySchema = z.object({
  question: z.string().min(1).max(300),
  discipline: z.enum(DISCIPLINES),
  /** 1-5, how often this company asks it. Same scale as a prep page's own ask score. */
  frequency: z.number().int().min(0).max(5).optional().default(0),
  last_asked: isoDate.nullish(),
});

/**
 * Merge by default, never replace by default.
 *
 * A page is built up over several sessions -- HLD questions today, LLD next week -- and the
 * later session does not have the earlier list to resend. Replacing by default would make the
 * obvious usage silently destructive.
 */
const mode = z.enum(["merge", "replace"]).optional().default("merge");

export const questionBankSchema = z.object({
  company: z.string().min(1).max(120),
  entries: z.array(bankEntrySchema).max(300),
  mode,
});

export const questionIndexSchema = z.object({
  company: z.string().min(1).max(120),
  discipline: z.enum(DISCIPLINES),
  questions: z
    .array(
      z.object({
        title: z.string().min(1).max(300),
        frequency: z.number().int().min(0).max(5).optional(),
        last_asked: isoDate.nullish(),
      }),
    )
    .max(300),
  mode,
});
