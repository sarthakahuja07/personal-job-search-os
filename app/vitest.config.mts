import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mirrors the "@/*" -> "./src/*" alias in tsconfig. Without it, any test that reaches a
    // module importing "@/db" fails to resolve -- which is how the bound-parameter test could
    // not even load.
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // Domain and service layers only. These are pure and must stay fast; anything needing a
    // Worker runtime belongs in a separate project.
    include: ["src/server/**/*.test.ts"],
    environment: "node",
  },
});
