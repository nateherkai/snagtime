import { build } from "esbuild";

const buildId = process.env.BUILD_ID || "development";
if (buildId !== "development" && !/^[a-f0-9]{40,64}$/i.test(buildId)) throw new Error("BUILD_ID must be an immutable 40-64 character hexadecimal identity.");
await build({
  entryPoints: ["apps/web/src/server/worker.ts"], bundle: true, platform: "node", format: "esm", packages: "external",
  tsconfig: "apps/web/tsconfig.json", outfile: "dist/worker.mjs",
  define: { "process.env.TEMPOCOVE_COMPILED_BUILD_ID": JSON.stringify(buildId) },
});
console.log(`Worker artifact compiled with ${buildId === "development" ? "the local development identity" : "an immutable release identity"}.`);
