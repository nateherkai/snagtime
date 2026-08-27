import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const KEY_BYTES = 32;

export function assertStrongPassword(password: string) {
  if (password.length < 12 || password.length > 200 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    throw new Error("Password must be 12–200 characters and include upper, lower, number, and symbol.");
  }
}

export async function hashPassword(password: string) {
  assertStrongPassword(password);
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEY_BYTES) as Buffer;
  return `scrypt:v1:${salt.toString("base64url")}:${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, encoded: string) {
  const [algorithm, version, saltText, hashText] = encoded.split(":");
  if (algorithm !== "scrypt" || version !== "v1" || !saltText || !hashText) return false;
  try {
    const expected = Buffer.from(hashText, "base64url");
    const actual = await scrypt(password, Buffer.from(saltText, "base64url"), expected.length) as Buffer;
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch { return false; }
}
