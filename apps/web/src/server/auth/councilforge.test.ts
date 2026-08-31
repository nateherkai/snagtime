import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { assertLocalAccountAuthorityAllowed, councilForgeLocalIds, councilForgeWorkspaceRole, verifyCouncilForgeAssertion } from "./councilforge";

const secret = "councilforge-sso-test-secret-at-least-32-bytes";
const base = { iss: "https://admin.aiautomationauthority.com", aud: "snagtime.aiautomationauthority.com", sub: "11111111-1111-4111-8111-111111111111", company_id: "globalr", pg_company_id: "22222222-2222-4222-8222-222222222222", company_name: "Global Realtor", email: "USER@example.com", name: "User", role: "editor", iat: 1000, exp: 1060, jti: "33333333-3333-4333-8333-333333333333" };
function sign(value = base) { const encoded = Buffer.from(JSON.stringify(value)).toString("base64url"); return `${encoded}.${createHmac("sha256", secret).update(encoded).digest("base64url")}`; }

describe("CouncilForge SSO", () => {
  it("verifies, normalizes, and maps a valid assertion", () => {
    const payload = verifyCouncilForgeAssertion(sign(), secret, 1030);
    expect(payload.email).toBe("user@example.com");
    expect(councilForgeWorkspaceRole(payload.role)).toBe("MEMBER");
    expect(councilForgeLocalIds(payload)).toEqual(councilForgeLocalIds(payload));
  });
  it("rejects tampering, expiration, and excessive privilege values", () => {
    expect(() => verifyCouncilForgeAssertion(`${sign()}x`, secret, 1030)).toThrow();
    expect(() => verifyCouncilForgeAssertion(sign(), secret, 1061)).toThrow(/Expired/);
    expect(() => verifyCouncilForgeAssertion(sign({ ...base, role: "owner" } as typeof base), secret, 1030)).toThrow(/role/);
  });
  it("maps only trusted administrative roles to workspace administration", () => {
    expect(councilForgeWorkspaceRole("super_admin")).toBe("OWNER");
    expect(councilForgeWorkspaceRole("admin")).toBe("ADMIN");
    expect(councilForgeWorkspaceRole("viewer")).toBe("MEMBER");
  });
  it("fails closed for local account authority in CouncilForge-only mode", () => {
    const prior = process.env.SNAGTIME_COUNCILFORGE_ONLY;
    process.env.SNAGTIME_COUNCILFORGE_ONLY = "true";
    expect(() => assertLocalAccountAuthorityAllowed()).toThrow(/CouncilForge/);
    process.env.SNAGTIME_COUNCILFORGE_ONLY = prior;
  });
});
