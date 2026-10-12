import { defineConfig } from "vitest/config";

const buildId = process.env.GITHUB_SHA?.slice(0, 12) ?? Date.now().toString(36);

export default defineConfig({
  // Relative asset URLs so the build works under the GitHub Pages sub-path (/pairloom/).
  base: "./",
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
  },
  plugins: [
    {
      name: "version-json",
      generateBundle() {
        this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ build: buildId }) });
      },
    },
  ],
  test: {
    include: ["src/**/*.test.ts"],
  },
});
