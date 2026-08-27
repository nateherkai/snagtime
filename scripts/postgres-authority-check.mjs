import { createRequire } from "node:module"; import { randomUUID } from "node:crypto";
const require=createRequire(import.meta.url); const { PrismaClient }=require("@tempocove/postgresql-client"); const db=new PrismaClient({datasourceUrl:process.env.DATABASE_URL}); const ids=[]; const userIds=[];
const mustReject=async(label,operation)=>{try{await operation();throw new Error(`${label} accepted`)}catch(error){if(String(error).includes(`${label} accepted`))throw error;}};
try {
  const userA=await db.user.create({data:{email:`pg-a-${randomUUID()}@example.invalid`,name:"A",passwordHash:"x"}}); const userB=await db.user.create({data:{email:`pg-b-${randomUUID()}@example.invalid`,name:"B",passwordHash:"x"}}); userIds.push(userA.id,userB.id);
  const workspaceA=await db.workspace.create({data:{name:"PG A"}}); const workspaceB=await db.workspace.create({data:{name:"PG B"}}); ids.push(workspaceA.id,workspaceB.id);
  const membershipA=await db.membership.create({data:{workspaceId:workspaceA.id,userId:userA.id,role:"OWNER"}}); await db.membership.create({data:{workspaceId:workspaceB.id,userId:userB.id,role:"OWNER"}});
  const eventA=await db.eventType.create({data:{workspaceId:workspaceA.id,ownerId:userA.id,name:"PG Guard",slug:`pg-${randomUUID()}`,locationType:"CUSTOM"}});
  await mustReject("cross-workspace booking",()=>db.booking.create({data:{workspaceId:workspaceB.id,eventTypeId:eventA.id,hostId:userB.id,durationMinutes:30,inviteeName:"X",inviteeEmail:"x@example.invalid",inviteeTimeZone:"UTC",startAt:new Date("2099-01-01T00:00:00Z"),endAt:new Date("2099-01-01T00:30:00Z"),capabilityVersion:randomUUID(),manageExpiresAt:new Date("2099-02-01Z")}}));
  await mustReject("last owner delete",()=>db.membership.delete({where:{id:membershipA.id}}));
  const booking=await db.booking.create({data:{workspaceId:workspaceA.id,eventTypeId:eventA.id,hostId:userA.id,durationMinutes:30,inviteeName:"X",inviteeEmail:"x@example.invalid",inviteeTimeZone:"UTC",startAt:new Date("2099-01-02T00:00:00Z"),endAt:new Date("2099-01-02T00:30:00Z"),capabilityVersion:randomUUID(),manageExpiresAt:new Date("2099-02-01Z")}});
  const outbox=await db.emailOutbox.create({data:{workspaceId:workspaceA.id,bookingId:booking.id,kind:"BOOKING_CONFIRMED",recipientEmail:"x@example.invalid",subjectSnapshot:"Immutable",payloadJson:"{}",idempotencyKey:randomUUID()}});
  await mustReject("email snapshot mutation",()=>db.emailOutbox.update({where:{id:outbox.id},data:{payloadJson:'{"changed":true}'}}));
  const posture=await db.$queryRawUnsafe("SELECT count(*)::int AS count FROM pg_roles WHERE rolname IN ('tempocove_app','tempocove_worker','tempocove_monitor') AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolcanlogin AND NOT rolbypassrls"); if(Number(posture[0].count)!==3)throw new Error("role posture mismatch");
  console.log("PostgreSQL tenant, owner, immutability, and role posture negatives passed.");
} finally {
  if(ids.length){await db.booking.deleteMany({where:{workspaceId:{in:ids}}});await db.workspace.deleteMany({where:{id:{in:ids}}});await db.user.deleteMany({where:{id:{in:userIds}}});} await db.$disconnect();
}
