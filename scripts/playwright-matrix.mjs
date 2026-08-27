import { spawn } from "node:child_process";
import { resolve } from "node:path";

const projects = ["chromium-desktop", "edge-desktop", "chromium-mobile", "edge-mobile"];
const forwarded = process.argv.slice(2);
for (const [index, project] of projects.entries()) {
  const status = await new Promise((resolveStatus, reject) => {
    const child = spawn(process.execPath, [resolve("node_modules", "@playwright", "test", "cli.js"), "test", "--project", project, ...forwarded], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PLAYWRIGHT_PORT: String(3210 + index),
        PLAYWRIGHT_DATABASE_PATH: resolve("runtime", "playwright", `e2e-${project}.db`),
      },
      stdio: "inherit",
      shell: false,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolveStatus(signal ? 1 : code ?? 1));
  });
  if (status !== 0) process.exit(status);
}
