import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Domain and service layers only. These are pure and must stay fast; anything needing a
    // Worker runtime belongs in a separate project.
    include: ["src/server/**/*.test.ts"],
    environment: "node",
  },
});
