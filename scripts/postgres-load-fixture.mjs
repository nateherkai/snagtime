import { appendFileSync } from "node:fs";
import { createCipheriv, randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";

const outputNames = ["event_slug","duration_id","second_event_slug","second_duration_id","missing_event_slug","missing_duration_id","start_at"];
function emit(values) {
  const output = process.env.GITHUB_OUTPUT;
  if (!output) throw new Error("GITHUB_OUTPUT is required for deterministic fixture handoff.");
  for (const name of outputNames) {
    const value = values[name];
    if (!value || /[\r\n]/.test(value)) throw new Error(`Fixture output ${name} is missing or malformed.`);
    appendFileSync(output, `${name}=${value}\n`, "utf8");
  }
}

if (process.argv.includes("--contract-test")) {
  emit({ event_slug: "fixture-primary", duration_id: "duration-primary", second_event_slug: "fixture-secondary", second_duration_id: "duration-secondary", missing_event_slug: "fixture-missing", missing_duration_id: "duration-missing", start_at: "2099-01-05T10:00:00.000Z" });
  process.exit(0);
}

const databaseUrl = process.env.LOAD_PROOF_DATABASE_URL || "";
const tokenKey = Buffer.from(process.env.LOAD_FIXTURE_TOKEN_ENCRYPTION_KEY || "", "hex");
if (!/^postgres(?:ql)?:\/\//.test(databaseUrl) || tokenKey.length !== 32) throw new Error("LOAD_PROOF_DATABASE_URL and a 32-byte LOAD_FIXTURE_TOKEN_ENCRYPTION_KEY are required.");
const require = createRequire(import.meta.url); const { PrismaClient } = require("@tempocove/postgresql-client");
const db = new PrismaClient({ datasourceUrl: databaseUrl }); const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
function encrypt(value) { const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",tokenKey,iv),ciphertext=Buffer.concat([cipher.update(value,"utf8"),cipher.final()]);return `aesgcm:v1:${iv.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${ciphertext.toString("base64url")}`; }
async function createWorkspace(tx, label, connected) {
  const user=await tx.user.create({data:{email:`load-${label}-${suffix}@example.invalid`,name:`Load ${label}`,passwordHash:"fixture-not-a-login",emailVerifiedAt:new Date(),timeZone:"UTC"}});
  const workspace=await tx.workspace.create({data:{name:`Load ${label} ${suffix}`,timeZone:"UTC",onboardingCompletedAt:new Date()}});
  await tx.membership.create({data:{workspaceId:workspace.id,userId:user.id,role:"OWNER",status:"ACTIVE"}});
  if(connected)await tx.oAuthConnection.create({data:{workspaceId:workspace.id,userId:user.id,provider:"google",providerUserId:`load-${label}-${suffix}`,refreshToken:encrypt(`refresh-${label}-${suffix}`),accessToken:encrypt(`access-${label}-${suffix}`),expiresAt:new Date(Date.now()+3_600_000),calendarId:"primary",disconnectStatus:"ACTIVE"}});
  const schedule=await tx.availabilitySchedule.create({data:{workspaceId:workspace.id,userId:user.id,timeZone:"UTC"}});
  await tx.availabilityInterval.createMany({data:Array.from({length:7},(_,dayOfWeek)=>({scheduleId:schedule.id,dayOfWeek,startMinute:0,endMinute:1440}))});
  const event=await tx.eventType.create({data:{workspaceId:workspace.id,ownerId:user.id,name:`Load ${label}`,slug:`load-${label}-${suffix}`,description:"Synthetic native load fixture",locationType:"CUSTOM",locationValue:"Synthetic QA",minimumNoticeMinutes:0,bookingWindowDays:120,isActive:true}});
  const duration=await tx.eventDuration.create({data:{eventTypeId:event.id,label:"30 minutes",durationMinutes:30,isDefault:true,isActive:true,priceCents:0,currency:"usd"}});
  return {workspaceId:workspace.id,userId:user.id,eventId:event.id,slug:event.slug,durationId:duration.id,connected};
}

try {
  const fixture=await db.$transaction(async tx=>({primary:await createWorkspace(tx,"primary",true),secondary:await createWorkspace(tx,"secondary",true),missing:await createWorkspace(tx,"missing",false)}));
  const descriptors=[fixture.primary,fixture.secondary,fixture.missing];
  const events=await db.eventType.findMany({where:{id:{in:descriptors.map(item=>item.eventId)}},include:{durations:true}});
  const connections=await db.oAuthConnection.findMany({where:{workspaceId:{in:descriptors.map(item=>item.workspaceId)},provider:"google"},select:{workspaceId:true,disconnectStatus:true,refreshToken:true}});
  for(const item of descriptors){const event=events.find(row=>row.id===item.eventId);const connection=connections.find(row=>row.workspaceId===item.workspaceId);if(!event||event.workspaceId!==item.workspaceId||event.ownerId!==item.userId||event.slug!==item.slug||event.durations.length!==1||event.durations[0].id!==item.durationId||event.durations[0].eventTypeId!==event.id)throw new Error("Load fixture event/duration/workspace identity validation failed.");if(item.connected?(!connection||connection.disconnectStatus!=="ACTIVE"||!connection.refreshToken):Boolean(connection))throw new Error("Load fixture credential lineage validation failed.");}
  const start=new Date(Date.now()+14*86_400_000);start.setUTCHours(10,0,0,0);
  emit({event_slug:fixture.primary.slug,duration_id:fixture.primary.durationId,second_event_slug:fixture.secondary.slug,second_duration_id:fixture.secondary.durationId,missing_event_slug:fixture.missing.slug,missing_duration_id:fixture.missing.durationId,start_at:start.toISOString()});
  console.log("Native load fixture created and exact workspace/event/duration/credential lineage validated.");
} finally { await db.$disconnect(); }
