import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { AppError } from "@/server/errors";

export type CouncilForgeAssertion = {
  iss: string;
  aud: string;
  sub: string;
  company_id: string;
  pg_company_id: string;
  company_name: string;
  email: string;
  name: string;
  role: "super_admin" | "admin" | "editor" | "viewer";
  iat: number;
  exp: number;
  jti: string;
};

const textFields = ["sub", "company_id", "pg_company_id", "company_name", "email", "name", "jti"] as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function decodeBase64Url(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid CouncilForge assertion encoding.");
  return Buffer.from(value, "base64url");
}

export function verifyCouncilForgeAssertion(assertion: string, secret: string, now = Math.floor(Date.now() / 1000)): CouncilForgeAssertion {
  if (Buffer.byteLength(secret) < 32 || assertion.length > 8192) throw new Error("CouncilForge SSO is unavailable.");
  const parts = assertion.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error("Invalid CouncilForge assertion.");
  const supplied = decodeBase64Url(parts[1]);
  const expected = createHmac("sha256", secret).update(parts[0]).digest();
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new Error("Invalid CouncilForge assertion.");

  let payload: CouncilForgeAssertion;
  try { payload = JSON.parse(decodeBase64Url(parts[0]).toString("utf8")) as CouncilForgeAssertion; }
  catch { throw new Error("Invalid CouncilForge assertion."); }
  if (payload.iss !== "https://admin.aiautomationauthority.com" || payload.aud !== "snagtime.aiautomationauthority.com") throw new Error("Invalid CouncilForge assertion scope.");
  if (!Number.isInteger(payload.iat) || !Number.isInteger(payload.exp) || payload.iat > now + 10 || payload.exp < now || payload.exp <= payload.iat || payload.exp - payload.iat > 60) throw new Error("Expired CouncilForge assertion.");
  for (const field of textFields) if (typeof payload[field] !== "string" || !payload[field].trim() || payload[field].length > 320) throw new Error("Invalid CouncilForge assertion identity.");
  if (!uuid.test(payload.sub) || !uuid.test(payload.pg_company_id) || !uuid.test(payload.jti)) throw new Error("Invalid CouncilForge identity.");
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(payload.company_id) || !/^\S+@\S+\.\S+$/.test(payload.email)) throw new Error("Invalid CouncilForge tenant identity.");
  if (!["super_admin", "admin", "editor", "viewer"].includes(payload.role)) throw new Error("Invalid CouncilForge role.");
  return { ...payload, email: payload.email.trim().toLowerCase(), name: payload.name.trim(), company_name: payload.company_name.trim() };
}

export function assertLocalAccountAuthorityAllowed() {
  if (process.env.SNAGTIME_COUNCILFORGE_ONLY === "true") {
    throw new AppError("COUNCILFORGE_AUTH_REQUIRED", "Manage account access in CouncilForge.", 403);
  }
}

export function councilForgeLocalIds(payload: CouncilForgeAssertion) {
  const digest = (scope: string, value: string) => createHash("sha256").update(`councilforge:${scope}:${value}`).digest("hex").slice(0, 32);
  return { userId: `cfu_${digest("user", payload.sub)}`, workspaceId: `cfw_${digest("company", payload.pg_company_id)}` };
}

export function councilForgeWorkspaceRole(role: CouncilForgeAssertion["role"]): "OWNER" | "ADMIN" | "MEMBER" {
  if (role === "super_admin") return "OWNER";
  if (role === "admin") return "ADMIN";
  return "MEMBER";
}
