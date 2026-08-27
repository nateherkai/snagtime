import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function encryptionKey() {
  const text = process.env.TOKEN_ENCRYPTION_KEY;
  if (!text || !/^[0-9A-Fa-f]{64}$/.test(text)) throw new Error("TOKEN_ENCRYPTION_KEY must be exactly 32 random bytes encoded as 64 hex characters.");
  const key = Buffer.from(text, "hex");
  if (new Set(key).size < 16) throw new Error("TOKEN_ENCRYPTION_KEY does not have sufficient byte diversity.");
  return key;
}

export function encryptToken(value: string | null | undefined) {
  if (!value) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `aesgcm:v1:${iv.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${encrypted.toString("base64url")}`;
}

export function decryptToken(value: string | null | undefined) {
  if (!value) return null;
  const [algorithm, version, ivText, tagText, cipherText] = value.split(":");
  if (algorithm !== "aesgcm" || version !== "v1" || !ivText || !tagText || !cipherText) throw new Error("Encrypted token format is invalid.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(cipherText, "base64url")), decipher.final()]).toString("utf8");
}
