/**
 * Message template data access.
 *
 * Templates are user-editable text, not code, so there is nothing here but CRUD and a one-time
 * seed of the three PRD examples.
 */

import { asc, eq } from "drizzle-orm";

import type { Db } from "@/db";
import { templates } from "@/db/schema";
import { DEFAULT_TEMPLATES } from "../domain/templates";

export async function listTemplates(db: Db) {
  return db.select().from(templates).orderBy(asc(templates.createdAt));
}

export async function getTemplate(db: Db, id: string) {
  const rows = await db.select().from(templates).where(eq(templates.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function createTemplate(db: Db, name: string, body: string) {
  const id = crypto.randomUUID();
  await db.insert(templates).values({ id, name, body });
  return id;
}

export async function updateTemplate(db: Db, id: string, name: string, body: string) {
  await db
    .update(templates)
    .set({ name, body, updatedAt: new Date() })
    .where(eq(templates.id, id));
}

export async function deleteTemplate(db: Db, id: string) {
  await db.delete(templates).where(eq(templates.id, id));
}

/**
 * Seed the three starter templates, once.
 *
 * Guarded on the table being empty rather than on individual names, so a deliberately deleted
 * template stays deleted instead of reappearing on the next page load.
 */
export async function seedTemplatesIfEmpty(db: Db): Promise<number> {
  const existing = await db.select({ id: templates.id }).from(templates).limit(1);
  if (existing.length > 0) return 0;

  await db.insert(templates).values(
    DEFAULT_TEMPLATES.map((t) => ({
      id: crypto.randomUUID(),
      name: t.name,
      body: t.body,
    })),
  );
  return DEFAULT_TEMPLATES.length;
}
