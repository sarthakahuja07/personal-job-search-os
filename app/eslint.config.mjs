import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // `const { node, ...rest } = props` is how a prop is *omitted* before the rest is spread
      // onto a DOM element. The discarded name is the point of the destructure, not an oversight.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { ignoreRestSiblings: true, argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  // Override default ignores of eslint-config-next. Overriding *replaces* them, so the
  // defaults have to be restated here alongside our own.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",

    // Generated, not authored. Without these, `npm run lint` reports ~16800 problems in
    // build output and drowns the handful that are ours -- which is the same as having no
    // linter at all. `.open-next/` is the OpenNext worker bundle; the two .d.ts files are
    // emitted by `wrangler types`.
    ".open-next/**",
    "worker-configuration.d.ts",
    "cloudflare-env.d.ts",
  ]),
]);

export default eslintConfig;
