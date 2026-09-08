import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    /**
     * Keep navigated pages in the client router cache.
     *
     * Adding `loading.tsx` to every route turned this off: with a loading boundary, the dynamic
     * segment's client cache defaults to 0 seconds, so going back to the job board refetched it,
     * showed the skeleton, and collapsed the page height — which is why the browser could not
     * restore the scroll position you left from.
     *
     * 30 seconds is safe here because the data changes twice a day, not continuously, and every
     * mutation (mark read, track, move stage) calls revalidatePath, which evicts these entries
     * regardless of age. So the cache can only ever serve something stale that nothing has
     * changed.
     */
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
  },
};

export default nextConfig;

// Makes Cloudflare bindings (D1, secrets) available to `next dev`, so local development
// runs against a real local D1 instance rather than a mock.
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
