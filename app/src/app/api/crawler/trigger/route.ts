import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * POST /api/crawler/trigger
 *
 * Run the crawl now, instead of waiting for 06:30 or 18:30.
 *
 * The crawler is Python and runs in GitHub Actions — Workers cannot execute it — so "run now"
 * means dispatching the workflow. `crawl.yml` already ends by draining the notification outbox,
 * so one dispatch both crawls every company and sends the digest; there is deliberately no
 * separate "send notifications" button, because a digest with nothing new in it is not a thing
 * worth being able to trigger.
 *
 * Dispatch is fire-and-forget by nature: GitHub returns 204 with no run id, so this reports that
 * the run was *queued*, never that it succeeded. Claiming otherwise would be the same class of
 * lie as a crawler reporting success while returning nothing.
 */
export async function POST(): Promise<Response> {
  // Read the binding inside the handler, not at module scope: importing `cloudflare:workers`
  // env at the top level is evaluated while the build collects route config, and fails there.
  // Every other binding in this codebase is reached the same way (see src/db, server/auth).
  const { env } = getCloudflareContext();
  const bindings = env as unknown as {
    GITHUB_DISPATCH_TOKEN?: string;
    GITHUB_REPO?: string;
  };
  const token = bindings.GITHUB_DISPATCH_TOKEN;
  const repo = bindings.GITHUB_REPO ?? "sarthakahuja07/personal-job-search-os";

  if (!token) {
    // A missing secret is a setup gap, not a fault. Say exactly what to do about it.
    return Response.json(
      {
        error: "not_configured",
        message:
          "No GITHUB_DISPATCH_TOKEN is set, so the crawl cannot be started from here. " +
          "Create a fine-grained token with Actions: read and write on this repository, then " +
          "run: npx wrangler secret put GITHUB_DISPATCH_TOKEN",
      },
      { status: 501 },
    );
  }

  try {
    const response = await fetch(
      `https://api.github.com/repos/${repo}/actions/workflows/crawl.yml/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "job-search-os",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ref: "main" }),
        signal: AbortSignal.timeout(15_000),
      },
    );

    if (response.status === 204) {
      return Response.json({
        ok: true,
        message: "Crawl queued. It takes a couple of minutes; the digest follows automatically.",
        runsUrl: `https://github.com/${repo}/actions/workflows/crawl.yml`,
      });
    }

    const detail = (await response.text()).slice(0, 300);
    return Response.json(
      {
        error: "dispatch_failed",
        message:
          response.status === 403 || response.status === 404
            ? "GitHub refused the dispatch. The token usually needs Actions: read and write on this repository."
            : `GitHub returned ${response.status}. ${detail}`,
      },
      { status: 502 },
    );
  } catch (error) {
    return Response.json(
      {
        error: "unreachable",
        message:
          error instanceof Error && error.name === "TimeoutError"
            ? "GitHub did not respond in time. The crawl may still have been queued."
            : "Could not reach GitHub to start the crawl.",
      },
      { status: 502 },
    );
  }
}
