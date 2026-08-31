import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { enterDatabaseContext } from "@/server/db-context";
import { createSessionForUser, SESSION_COOKIE, sessionCookieOptions } from "@/server/auth/session";
import { councilForgeLocalIds, councilForgeWorkspaceRole, verifyCouncilForgeAssertion } from "@/server/auth/councilforge";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") || "";
    const declaredLength = Number(request.headers.get("content-length") || "0");
    if (!contentType.toLowerCase().startsWith("application/x-www-form-urlencoded") || declaredLength > 10240) return NextResponse.json({ error: "Invalid SSO request." }, { status: 415 });
    const body = await request.text();
    if (Buffer.byteLength(body) > 10240) return NextResponse.json({ error: "Invalid SSO request." }, { status: 413 });
    const form = new URLSearchParams(body);
    const payload = verifyCouncilForgeAssertion(form.get("assertion") || "", process.env.SNAGTIME_SSO_SECRET || "");
    const { userId, workspaceId } = councilForgeLocalIds(payload);
    const role = councilForgeWorkspaceRole(payload.role);

    enterDatabaseContext({ mode: "federated", workspaceId, userId, subject: payload.jti, action: "councilforge_sso" });
    const rows = await db.$queryRawUnsafe<Array<{ membership_id: string }>>(
      "SELECT tempocove_councilforge_sso_bootstrap($1,$2,$3,$4,$5,$6,$7,$8,$9) AS membership_id",
      payload.jti, new Date(payload.exp * 1000), userId, payload.sub, workspaceId,
      payload.pg_company_id, payload.company_id, payload.company_name, JSON.stringify({ email: payload.email, name: payload.name, role }),
    );
    const membershipId = rows[0]?.membership_id;
    if (!membershipId) throw new Error("CouncilForge membership bootstrap failed.");
    const token = await createSessionForUser(userId, membershipId, true);
    const response = NextResponse.redirect(new URL("/dashboard", request.url), 303);
    response.headers.set("Cache-Control", "no-store");
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
    return response;
  } catch (error) {
    console.error("CouncilForge SSO failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "CouncilForge authentication failed. Return to the Admin Dashboard and try again." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
}
