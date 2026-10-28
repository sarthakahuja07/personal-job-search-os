"use server";

import { revalidatePath } from "next/cache";

import { getDb } from "@/db";
import { setLastCalled } from "@/server/repository/hr-repo";

function revalidate() {
  revalidatePath("/hr");
  revalidatePath("/");
}

/**
 * Record a call to an HR contact.
 *
 * Deliberately a separate step from dialling: tapping Call opens the phone app, and the call may
 * not connect. Only "I spoke to them" should silence the prompt, otherwise a missed call would
 * quietly mark the company as handled.
 */
export async function markCalled(contactId: string): Promise<number> {
  const at = new Date();
  await setLastCalled(getDb(), contactId, at);
  revalidate();
  // Returned so the client can tell, after the row re-renders elsewhere, that this stamp is the
  // one it made and Undo still applies.
  return at.getTime();
}

/** Put back the previous call time, for a "Called" tapped by mistake. */
export async function undoCalled(contactId: string, previousMs: number | null) {
  await setLastCalled(getDb(), contactId, previousMs ? new Date(previousMs) : null);
  revalidate();
}
