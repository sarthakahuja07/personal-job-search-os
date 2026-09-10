"use server";

import { revalidatePath } from "next/cache";

import { getDb } from "@/db";
import { updateBody } from "@/server/repository/prep-repo";

/**
 * Save a page's body.
 *
 * Called from the editor as you type rather than from a Save button, so it has to be cheap and
 * safe to call often. It writes one column and revalidates the page it wrote — not the whole
 * prep tree, which would make every keystroke pay for a sidebar rebuild.
 */
export async function savePageBody(id: string, body: string, path: string) {
  await updateBody(getDb(), id, body.trim() || null);
  revalidatePath(path);
  return { savedAt: Date.now() };
}
