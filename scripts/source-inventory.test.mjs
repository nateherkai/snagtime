import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { collect, hashSourcePaths, ignoredSourceDirectory } from "./source-inventory.mjs";

test("excludes .next and every .next-* directory at any depth", () => {
  const root = mkdtempSync(join(tmpdir(), "tempocove-source-inventory-"));
  try {
    const source = join(root, "apps", "web", "src");
    mkdirSync(join(source, "nested", ".next-arbitrary", "deeper"), { recursive: true });
    mkdirSync(join(source, ".next", "server"), { recursive: true });
    mkdirSync(join(source, ".next-playwright", "server"), { recursive: true });
    mkdirSync(join(source, "node_modules", "package"), { recursive: true });
    writeFileSync(join(source, "kept.ts"), "export const kept = true;\n");
    writeFileSync(join(source, "nested", ".next-arbitrary", "deeper", "generated.js"), "secret generated output\n");
    writeFileSync(join(source, ".next", "server", "generated.js"), "generated\n");
    writeFileSync(join(source, ".next-playwright", "server", "generated.js"), "generated\n");
    writeFileSync(join(source, "node_modules", "package", "index.js"), "dependency\n");

    assert.equal(ignoredSourceDirectory(".next"), true);
    assert.equal(ignoredSourceDirectory(".next-arbitrary"), true);
    assert.equal(ignoredSourceDirectory(".next-playwright"), true);
    assert.equal(ignoredSourceDirectory("next-source"), false);
    assert.deepEqual(collect(join(root, "apps"), root), ["apps/web/src/kept.ts"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reports an unreadable in-universe path without exposing content", () => {
  const denied = Object.assign(new Error("platform-specific detail"), { code: "EACCES" });
  assert.throws(
    () => hashSourcePaths(["apps/web/src/private.ts"], process.cwd(), () => { throw denied; }),
    { message: "Source inventory could not read apps/web/src/private.ts (EACCES)." },
  );
});
