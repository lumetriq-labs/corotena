import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vitest/config";

const buildId = process.env.GITHUB_SHA?.slice(0, 12) ?? Date.now().toString(36);

const listFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? listFiles(p) : [p];
  });

export default defineConfig({
  // Relative asset URLs so the build works under the GitHub Pages sub-path (/pairloom/).
  base: "./",
  build: {
    rollupOptions: {
      input: { main: "index.html", about: "about.html" },
    },
  },
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
    {
      name: "service-worker",
      apply: "build",
      // After everything (HTML included) is on disk, so the file list is complete.
      writeBundle({ dir = "dist" }) {
        const files = listFiles(dir)
          .map(f => path.relative(dir, f).split(path.sep).join("/"))
          .filter(f => !["version.json", "sw.js"].includes(f) && !f.endsWith(".DS_Store"))
          .sort();
        const precache = files.map(f => (f === "index.html" ? "./" : `./${f}`));
        const source = fs.readFileSync(path.resolve("src/sw.js"), "utf8")
          .replace("__BUILD_ID__", JSON.stringify(buildId))
          .replace("__PRECACHE__", JSON.stringify(precache));
        fs.writeFileSync(path.join(dir, "sw.js"), source);
      },
    },
  ],
  test: {
    include: ["src/**/*.test.ts"],
  },
});
