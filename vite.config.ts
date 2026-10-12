import { defineConfig } from "vitest/config";

export default defineConfig({
  // Relative asset URLs so the build works under the GitHub Pages sub-path (/pairloom/).
  base: "./",
  test: {
    include: ["src/**/*.test.ts"],
  },
});
