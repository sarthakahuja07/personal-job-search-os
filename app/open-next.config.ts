import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Defaults are correct for this project: no incremental cache, no queue, no tag cache.
// The app is single-user and low-traffic, so caching infrastructure would be complexity
// without benefit (PRD §87, §91).
export default defineCloudflareConfig();
