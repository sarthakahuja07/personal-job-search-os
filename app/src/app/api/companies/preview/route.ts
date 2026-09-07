import { previewSource } from "@/server/service/source-preview";

/**
 * POST /api/companies/preview
 *
 * Dry-run a careers URL and report what it would crawl, so a company cannot be onboarded on a
 * detection that merely looks right. Reached only from the Add Company form, which sits behind
 * Cloudflare Access like every other page — there is no separate token to check here.
 */
export async function POST(request: Request): Promise<Response> {
  let careersUrl = "";
  try {
    const body = (await request.json()) as { careersUrl?: unknown };
    careersUrl = typeof body.careersUrl === "string" ? body.careersUrl : "";
  } catch {
    return Response.json({ error: "expected a JSON body" }, { status: 400 });
  }

  if (!careersUrl.trim()) {
    return Response.json({ error: "careersUrl is required" }, { status: 400 });
  }

  try {
    return Response.json(await previewSource(careersUrl));
  } catch (error) {
    // A failed probe is a result, not a server error -- previewSource already turns reachable
    // failures into a readable message. Reaching here means something unexpected broke.
    console.error("source preview failed", {
      careersUrl,
      error: error instanceof Error ? error.message : String(error),
    });
    return Response.json({ error: "preview failed unexpectedly" }, { status: 500 });
  }
}
