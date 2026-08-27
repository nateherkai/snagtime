import { copyFileSync, existsSync, mkdirSync, readdirSync, realpathSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { sourceInventory, sourcePaths } from "./source-inventory.mjs";

const root = realpathSync(process.cwd());
const requested = process.argv[2];
if (!requested) throw new Error("Provide an empty destination directory as the first argument.");

const destination = resolve(requested);
const relativeDestination = relative(root, destination);
if (!relativeDestination.startsWith("..") || relativeDestination === "") throw new Error("The public release destination must be outside the source repository.");
if (existsSync(destination) && readdirSync(destination).length > 0) throw new Error("The public release destination already exists and is not empty.");
mkdirSync(destination, { recursive: true });

const paths = sourcePaths(root);
for (const path of paths) {
  const target = resolve(destination, path);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(resolve(root, path), target);
}

console.log(JSON.stringify({ destination, ...sourceInventory(destination) }));
