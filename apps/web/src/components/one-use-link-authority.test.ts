import { describe, expect, it } from "vitest";
import { oneUseAuthorityFromUrl, shareOneUseAction } from "./one-use-link-authority";

describe("one-use link authority", () => {
  it("extracts fragment authority without placing it in the HTTP request or clean URL", () => {
    const token = "v1.fragment-secret.signature";
    const result = oneUseAuthorityFromUrl(`https://tempo.test/verify-email?source=email#token=${encodeURIComponent(token)}`, "token");
    expect(result).toEqual({ authority: token, cleanUrl: "/verify-email?source=email" });
    expect(new URL(`https://tempo.test/verify-email#token=${encodeURIComponent(token)}`).href.split("#")[0]).not.toContain(token);
    expect(result.cleanUrl).not.toContain(token);
  });

  it("preserves legacy query links while removing the authority from the cleaned URL", () => {
    const token = "v1.legacy-secret.signature";
    expect(oneUseAuthorityFromUrl(`https://tempo.test/reset-password?token=${encodeURIComponent(token)}&source=legacy`, "token"))
      .toEqual({ authority: token, cleanUrl: "/reset-password?source=legacy" });
  });

  it("shares only concurrent Strict Mode consumption and lets later attempts fail closed at the server", async () => {
    let successfulCalls = 0;
    const first = shareOneUseAction("verify", "success-authority", async () => { successfulCalls += 1; return "verified"; });
    const replay = shareOneUseAction("verify", "success-authority", async () => { successfulCalls += 1; return "unexpected"; });
    await expect(Promise.all([first, replay])).resolves.toEqual(["verified", "verified"]);
    await expect(shareOneUseAction("verify", "success-authority", async () => { successfulCalls += 1; return "server-replay"; })).resolves.toBe("server-replay");
    expect(successfulCalls).toBe(2);

    let rejectedCalls = 0;
    await expect(shareOneUseAction("invite", "retry-authority", async () => { rejectedCalls += 1; throw new Error("sign in required"); })).rejects.toThrow("sign in required");
    await expect(shareOneUseAction("invite", "retry-authority", async () => { rejectedCalls += 1; return "accepted"; })).resolves.toBe("accepted");
    expect(rejectedCalls).toBe(2);
  });
});
