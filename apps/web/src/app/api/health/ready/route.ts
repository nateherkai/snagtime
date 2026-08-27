import { NextResponse } from "next/server";
import { assertProductionRuntimeSecurity } from "@/server/auth/session";
import { healthQuery } from "@/server/health-db";
import { assertCompiledBuildIdentity } from "@/server/build-identity";
export const dynamic = "force-dynamic";
const timeout = <T,>(promise: Promise<T>, ms = 2_000) => Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);
export async function GET() {
  try {
    if(process.env.NODE_ENV!=="production")return NextResponse.json({status:"ready"},{headers:{"Cache-Control":"no-store"}});
    if (process.env.NODE_ENV === "production") {
      assertProductionRuntimeSecurity();
      assertCompiledBuildIdentity();
      const identity=await timeout(healthQuery<{role:string;app:boolean;worker:boolean}>("SELECT current_user AS role,pg_has_role(current_user,'tempocove_app','member') AS app,pg_has_role(current_user,'tempocove_worker','member') AS worker"));
      if(identity[0]?.role!=="tempocove_app_login"||identity[0].app!==true||identity[0].worker!==false)throw new Error("runtime-role-unready");
      const maximumHeartbeatAgeMs=Math.max(15_000,Number(process.env.OUTBOX_POLL_INTERVAL_MS||5_000)*3);
      const posture = await timeout(healthQuery<{ready:boolean}>("SELECT tempocove_readiness($1::integer) AS ready",[maximumHeartbeatAgeMs]));
      if (posture[0]?.ready !== true) throw new Error("runtime-dependencies-unready");
    }
    return NextResponse.json({ status: "ready" }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ status: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
