import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { healthQuery } from "@/server/health-db";
import { compiledBuildId } from "@/server/build-identity";
export const dynamic="force-dynamic";
export async function GET(request:Request){
  const expected=process.env.OPERATOR_HEALTH_SECRET||"",supplied=request.headers.get("x-tempocove-operator-secret")||""; const left=Buffer.from(expected),right=Buffer.from(supplied);
  if(left.length<32||left.length!==right.length||!timingSafeEqual(left,right))return NextResponse.json({status:"unauthorized"},{status:401,headers:{"Cache-Control":"no-store"}});
  try { const result=await healthQuery<{health:{integrationPending:number;integrationDead:number;emailPending:number;emailDead:number;worker:{status:string;lastSeenAt:string;buildId:string}|null}}>("SELECT tempocove_operator_health() AS health"); const health=result[0]?.health;
    return NextResponse.json({status:"ok",appBuildId:compiledBuildId,queues:{integration:{pending:Number(health?.integrationPending||0),dead:Number(health?.integrationDead||0)},email:{pending:Number(health?.emailPending||0),dead:Number(health?.emailDead||0)}},worker:health?.worker||null},{headers:{"Cache-Control":"no-store"}});
  } catch { return NextResponse.json({status:"unavailable"},{status:503,headers:{"Cache-Control":"no-store"}}); }
}
