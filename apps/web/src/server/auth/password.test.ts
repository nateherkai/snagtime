import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/server/auth/password";

describe("password authentication", () => {
  it("hashes with random salt and verifies without storing plaintext", async () => {
    const first = await hashPassword("Correct-Horse-42!");
    const second = await hashPassword("Correct-Horse-42!");
    expect(first).not.toBe(second);
    expect(first).not.toContain("Correct-Horse");
    expect(await verifyPassword("Correct-Horse-42!", first)).toBe(true);
    expect(await verifyPassword("Wrong-Horse-42!", first)).toBe(false);
  });
  it("rejects weak passwords", async () => { await expect(hashPassword("password")).rejects.toThrow(/12/); });
});
