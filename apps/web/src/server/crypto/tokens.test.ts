import { afterEach, describe, expect, it } from "vitest";
import { decryptToken, encryptToken } from "@/server/crypto/tokens";

const original = process.env.TOKEN_ENCRYPTION_KEY;
afterEach(() => { process.env.TOKEN_ENCRYPTION_KEY = original; });
describe("Google token encryption", () => {
  it("round-trips AES-GCM without plaintext persistence and rejects tampering", () => {
    process.env.TOKEN_ENCRYPTION_KEY = "00112233445566778899aabbccddeeffffeeddccbbaa99887766554433221100";
    const encrypted = encryptToken("refresh-secret")!;
    expect(encrypted).not.toContain("refresh-secret");
    expect(decryptToken(encrypted)).toBe("refresh-secret");
    const parts = encrypted.split(":"); parts[3] = `${parts[3]![0] === "A" ? "B" : "A"}${parts[3]!.slice(1)}`;
    expect(() => decryptToken(parts.join(":"))).toThrow();
  });
  it("rejects missing and low-diversity keys", () => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
    expect(() => encryptToken("secret")).toThrow(/32 random bytes/);
    process.env.TOKEN_ENCRYPTION_KEY = "00".repeat(32);
    expect(() => encryptToken("secret")).toThrow(/diversity/);
  });
});
