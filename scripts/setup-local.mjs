import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const templatePath = resolve(root, ".env.example");
const targetPath = resolve(root, ".env.local");
const args = process.argv.slice(2);

function valueAfter(flag) {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}

const force = args.includes("--force");
const email = valueAfter("--email") || "owner@example.com";
const generatedPassword = `Snag!7${randomBytes(12).toString("base64url")}`;
const password = valueAfter("--password") || generatedPassword;

if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("--email must be a valid email address.");
if (password.length < 12 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
  throw new Error("--password must contain at least 12 characters with uppercase, lowercase, a number, and punctuation.");
}
if (!existsSync(templatePath)) throw new Error(".env.example was not found. Run this command from the repository root.");
if (existsSync(targetPath) && !force) throw new Error(".env.local already exists. Keep it, remove it yourself, or rerun with --force to replace it.");

const replacements = new Map([
  ["replace-with-at-least-32-random-characters", randomBytes(32).toString("base64url")],
  ["replace-with-an-independent-32-byte-random-value", randomBytes(32).toString("base64url")],
  ["replace-with-64-random-hex-characters", randomBytes(32).toString("hex")],
  ["replace-with-a-strong-demo-password", password],
  ["owner@example.com", email],
]);

let environment = readFileSync(templatePath, "utf8");
for (const [placeholder, value] of replacements) environment = environment.replaceAll(placeholder, value);
writeFileSync(targetPath, environment, { encoding: "utf8", flag: "w" });

console.log("Created .env.local with generated application secrets.");
console.log(`Local login email: ${email}`);
console.log(`Local login password: ${password}`);
console.log("Save the login now. The file is ignored by Git and must never be committed.");
