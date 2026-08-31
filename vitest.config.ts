import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./apps/web/src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // Integration tests share the single local SQLite database. Running test
    // files concurrently lets one file observe or clean up another file's rows.
    fileParallelism: false,
    include: ["apps/web/src/**/*.test.ts"],
    exclude: ["**/._*"],
    coverage: {
      reporter: ["text", "json-summary"],
    },
  },
});
