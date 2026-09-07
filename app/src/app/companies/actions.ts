"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { getDb } from "@/db";
import { companies, contacts, type SourceConfig, type SourceType } from "@/db/schema";
import { detectSource, validateConfig } from "@/server/domain/source-detect";

function revalidateCompany(id?: string) {
  revalidatePath("/companies");
  if (id) revalidatePath(`/companies/${id}`);
  revalidatePath("/");
}

/**
 * Add a company from a pasted careers URL.
 *
 * If the URL is recognised the adapter and config are filled in automatically; if not, the
 * company is saved as `manual` rather than guessed at. Manual is a supported state that shows
 * up as something to check by hand — a wrong adapter would just fail quietly.
 */
export async function addCompany(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const careersUrl = String(formData.get("careersUrl") ?? "").trim();
  if (!name) return;

  const detected = careersUrl ? detectSource(careersUrl) : null;

  await getDb()
    .insert(companies)
    .values({
      id: crypto.randomUUID(),
      name,
      careersUrl: careersUrl || null,
      sourceType: detected?.sourceType ?? "manual",
      sourceTier: detected?.sourceTier ?? 6,
      sourceConfig: detected?.config ?? {},
      active: true,
    })
    .onConflictDoNothing();

  revalidateCompany();
}

export async function updateCompany(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const sourceType = String(formData.get("sourceType") ?? "manual") as SourceType;

  // Config fields are per-source; collect only the ones that apply and drop blanks so an
  // unused key never lingers to confuse the adapter.
  const config: SourceConfig = {};
  for (const key of ["boardToken", "slug", "companyId", "tenant", "dataCenter", "site"]) {
    const value = String(formData.get(key) ?? "").trim();
    if (value) config[key] = value;
  }

  const errors = validateConfig(sourceType, config);
  // Saving an invalid config would produce a crawler that fails every run. Fall back to manual
  // so the company still appears — as something to check by hand rather than as a broken source.
  const effectiveType: SourceType = errors.length > 0 ? "manual" : sourceType;

  await getDb()
    .update(companies)
    .set({
      name: String(formData.get("name") ?? "").trim(),
      careersUrl: String(formData.get("careersUrl") ?? "").trim() || null,
      websiteUrl: String(formData.get("websiteUrl") ?? "").trim() || null,
      sourceType: effectiveType,
      sourceTier: effectiveType === "manual" ? 6 : sourceTierFor(effectiveType),
      sourceConfig: config,
      active: formData.get("active") === "on",
      allowZeroResults: formData.get("allowZeroResults") === "on",
    })
    .where(eq(companies.id, id));

  revalidateCompany(id);
}

function sourceTierFor(sourceType: SourceType): number {
  if (sourceType === "workday") return 2;
  if (["greenhouse", "lever", "ashby", "smartrecruiters"].includes(sourceType)) return 1;
  if (sourceType === "custom_json") return 3;
  if (sourceType === "jsonld") return 4;
  if (sourceType === "html") return 5;
  return 6;
}

export async function deleteCompany(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  // Cascades to its jobs and contacts by foreign key.
  await getDb().delete(companies).where(eq(companies.id, id));
  revalidateCompany();
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

export async function addContact(formData: FormData) {
  const companyId = String(formData.get("companyId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!companyId || !name) return;

  await getDb().insert(contacts).values({
    id: crypto.randomUUID(),
    companyId,
    name,
    phone: String(formData.get("phone") ?? "").trim() || null,
    email: String(formData.get("email") ?? "").trim() || null,
    notes: String(formData.get("notes") ?? "").trim() || null,
  });

  revalidateCompany(companyId);
}

export async function updateContact(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const companyId = String(formData.get("companyId") ?? "");
  if (!id) return;

  await getDb()
    .update(contacts)
    .set({
      name: String(formData.get("name") ?? "").trim(),
      phone: String(formData.get("phone") ?? "").trim() || null,
      email: String(formData.get("email") ?? "").trim() || null,
      notes: String(formData.get("notes") ?? "").trim() || null,
      updatedAt: new Date(),
    })
    .where(eq(contacts.id, id));

  revalidateCompany(companyId);
}

export async function deleteContact(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const companyId = String(formData.get("companyId") ?? "");
  if (!id) return;
  await getDb().delete(contacts).where(eq(contacts.id, id));
  revalidateCompany(companyId);
}
