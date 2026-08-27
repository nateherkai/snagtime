import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { DateTime } from "luxon";
import * as dbContextModule from "../apps/web/src/server/db-context.ts";
import * as appDbModule from "../apps/web/src/server/db.ts";
import * as bookingsModule from "../apps/web/src/server/services/bookings.ts";
import * as accountsModule from "../apps/web/src/server/services/accounts.ts";
import * as recoveryModule from "../apps/web/src/server/services/account-recovery.ts";
import * as notificationsModule from "../apps/web/src/server/services/notifications.ts";
import * as passwordModule from "../apps/web/src/server/auth/password.ts";
import * as calendarsModule from "../apps/web/src/server/services/calendar.ts";
import * as paymentsModule from "../apps/web/src/server/services/payments.ts";
import type { PaymentService } from "@/server/services/payments";

const require=createRequire(import.meta.url);const {PrismaClient}=require("@tempocove/postgresql-client");
const dbContext=dbContextModule.databaseContext ?? (dbContextModule.default as typeof dbContextModule|undefined)?.databaseContext;
const enterDatabaseAction=dbContextModule.enterDatabaseAction ?? (dbContextModule.default as typeof dbContextModule|undefined)?.enterDatabaseAction;
const appDb=appDbModule.db ?? (appDbModule.default as typeof appDbModule|undefined)?.db;
const bookings=(bookingsModule.createBooking?bookingsModule:bookingsModule.default) as typeof bookingsModule;
const accounts=(accountsModule.createWorkspaceInvitation?accountsModule:accountsModule.default) as typeof accountsModule;
const recovery=(recoveryModule.requestPasswordReset?recoveryModule:recoveryModule.default) as typeof recoveryModule;
const notifications=(notificationsModule.materializeActionToken?notificationsModule:notificationsModule.default) as typeof notificationsModule;
const passwords=(passwordModule.hashPassword?passwordModule:passwordModule.default) as typeof passwordModule;
const calendars=(calendarsModule.getCalendarService?calendarsModule:calendarsModule.default) as typeof calendarsModule;
const paymentsService=(paymentsModule.processStripeWebhook?paymentsModule:paymentsModule.default) as typeof paymentsModule;
if(!dbContext||!enterDatabaseAction||!appDb||!bookings?.createBooking||!accounts?.createWorkspaceInvitation||!recovery?.requestPasswordReset||!notifications?.materializeActionToken||!passwords?.hashPassword||!calendars?.getCalendarService||!paymentsService?.processStripeWebhook)throw new Error("Application service modules did not load.");
const proof=new PrismaClient({datasourceUrl:process.env.PROOF_DATABASE_URL});
const suffix=randomUUID().slice(0,8);const userId=`svc-user-${suffix}`,workspaceId=`svc-workspace-${suffix}`;
const eventId=`svc-free-${suffix}`,paidEventId=`svc-paid-${suffix}`,durationId=`svc-duration-${suffix}`,paidDurationId=`svc-paid-duration-${suffix}`;
const calendar=calendars.getCalendarService();
const oldPassword="R4-Old!Password2026",newPassword="R4-New!Password2026";
const payments:PaymentService={async createCheckout(booking){return {sessionId:`cs_test_${booking.id}`,url:`https://checkout.stripe.test/${booking.id}`}},async expireCheckout(){}};
const start=DateTime.utc().plus({days:2}).startOf("hour").plus({hours:2}).toJSDate();
const rescheduled=DateTime.fromJSDate(start).plus({hours:2}).toJSDate();
try{
  await proof.user.create({data:{id:userId,email:`svc-${suffix}@example.invalid`,name:"Service owner",passwordHash:await passwords.hashPassword(oldPassword),timeZone:"UTC"}});
  await proof.workspace.create({data:{id:workspaceId,name:"Service DML",timeZone:"UTC"}});
  const membership=await proof.membership.create({data:{workspaceId,userId,role:"OWNER",status:"ACTIVE"}});
  const sessionHash=`service-session-${suffix}`;await proof.authSession.create({data:{userId,activeWorkspaceId:workspaceId,membershipId:membership.id,tokenHash:sessionHash,expiresAt:new Date("2099-01-01T00:00:00Z")}});
  await proof.workspaceBranding.create({data:{workspaceId,userId,workspaceName:"Service DML",accentColor:"#123456"}});
  await proof.oAuthConnection.create({data:{workspaceId,userId,provider:"google",providerUserId:`service-proof-${suffix}`,refreshToken:"encrypted-service-proof",disconnectStatus:"ACTIVE"}});
  const schedule=await proof.availabilitySchedule.create({data:{workspaceId,userId,timeZone:"UTC"}});
  await proof.availabilityInterval.createMany({data:Array.from({length:7},(_,dayOfWeek)=>({scheduleId:schedule.id,dayOfWeek,startMinute:0,endMinute:1440}))});
  await proof.eventType.create({data:{id:eventId,workspaceId,ownerId:userId,name:"Service free",slug:`service-free-${suffix}`,durationMinutes:30,minimumNoticeMinutes:0,bookingWindowDays:30,isActive:true}});
  await proof.eventDuration.create({data:{id:durationId,eventTypeId:eventId,label:"30 minutes",durationMinutes:30,isDefault:true,priceCents:0,currency:"usd"}});
  await proof.eventType.create({data:{id:paidEventId,workspaceId,ownerId:userId,name:"Service paid",slug:`service-paid-${suffix}`,durationMinutes:30,minimumNoticeMinutes:0,bookingWindowDays:30,isActive:true}});
  await proof.eventDuration.create({data:{id:paidDurationId,eventTypeId:paidEventId,label:"30 minutes",durationMinutes:30,isDefault:true,priceCents:2500,currency:"usd"}});

  const free=await bookings.createBooking(`service-free-${suffix}`,{startAt:start.toISOString(),inviteeName:"Free invitee",inviteeEmail:`free-${suffix}@example.invalid`,inviteeTimeZone:"UTC",durationId},`free-${suffix}`,calendar,payments);
  const base={mode:"workspace" as const,workspaceId,userId,sessionHash,subject:"OWNER",action:"workspace_read"};
  await dbContext.run(base,async()=>{enterDatabaseAction("booking_write");const authority=await appDb.$queryRawUnsafe<Array<{valid:boolean;actor:boolean;action:string;visible:number}>>("SELECT tempocove_context_valid('workspace') AS valid,tempocove_workspace_actor($1,$2) AS actor,current_setting('tempocove.action',true) AS action,(SELECT count(*)::int FROM \"Booking\" WHERE id=$3 AND \"mutationVersion\"=0 AND status='CONFIRMED' AND \"calendarLeaseToken\" IS NULL) AS visible",workspaceId,userId,free.booking.id);if(!authority[0]?.valid||!authority[0]?.actor||authority[0]?.action!=="booking_write"||authority[0]?.visible!==1)throw new Error(`Application booking action did not reach PostgreSQL transaction context ${JSON.stringify(authority[0])}`)});
  await dbContext.run(base,()=>bookings.rescheduleBooking(free.booking.id,rescheduled.toISOString(),calendar));
  await dbContext.run(base,()=>bookings.cancelBooking(free.booking.id,"service proof"));
  const access={workspaceId,user:{id:userId,email:`svc-${suffix}@example.invalid`,name:"Service owner",passwordHash:"fixture-password-hash",emailVerifiedAt:new Date(),imageUrl:null,timeZone:"UTC",createdAt:new Date(),updatedAt:new Date()},workspace:{id:workspaceId,name:"Service DML",timeZone:"UTC",onboardingCompletedAt:null,createdAt:new Date(),updatedAt:new Date()},membership:{...membership,createdAt:new Date(membership.createdAt),updatedAt:new Date(membership.updatedAt)}} as never;
  await dbContext.run(base,()=>accounts.createWorkspaceInvitation(access,`invite-${suffix}@example.invalid`,"MEMBER"));
  const accountEmail=`svc-${suffix}@example.invalid`;
  const recoveryTraces=Array.from({length:3},()=>[] as string[]),recoveryNow=new Date();
  await Promise.all(recoveryTraces.map(trace=>recovery.requestPasswordReset(accountEmail,recoveryNow,phase=>trace.push(phase))));
  if(recoveryTraces.some(trace=>JSON.stringify(trace)!==JSON.stringify(recoveryTraces[0])))throw new Error("Concurrent account recovery work traces diverged.");
  const activeResetCount=await proof.accountActionToken.count({where:{userId,purpose:"PASSWORD_RESET",revokedAt:null,consumedAt:null}});if(activeResetCount!==1)throw new Error(`Concurrent account recovery left ${activeResetCount} active reset authorities.`);
  await recovery.requestEmailVerification(accountEmail);
  const issued=await proof.accountActionToken.findMany({where:{userId,purpose:{in:["PASSWORD_RESET","EMAIL_VERIFY"]}},orderBy:{createdAt:"asc"}});
  const resetAuthority=issued.find((row)=>row.purpose==="PASSWORD_RESET"&&!row.revokedAt&&!row.consumedAt),verifyAuthority=issued.find((row)=>row.purpose==="EMAIL_VERIFY"&&!row.revokedAt&&!row.consumedAt);
  if(!resetAuthority||!verifyAuthority)throw new Error("Account request services did not emit both intended token authorities.");
  const materialize=(row:NonNullable<typeof resetAuthority>)=>notifications.materializeActionToken(row.id,row.purpose,notifications.accountTokenBinding(row.workspaceId,row.userId,row.email));
  const resetToken=materialize(resetAuthority),verifyToken=materialize(verifyAuthority);
  await recovery.verifyEmail(verifyToken);await recovery.resetPassword(resetToken,newPassword);
  for(const replay of [()=>recovery.verifyEmail(verifyToken),()=>recovery.resetPassword(resetToken,newPassword)]){let rejected=false;try{await replay()}catch{rejected=true}if(!rejected)throw new Error("Consumed account authority replay was accepted.")}
  const securedUser=await proof.user.findUniqueOrThrow({where:{id:userId}}),securedSession=await proof.authSession.findUniqueOrThrow({where:{tokenHash:sessionHash}});
  if(!securedUser.emailVerifiedAt||!securedSession.revokedAt||await passwords.verifyPassword(oldPassword,securedUser.passwordHash)||!await passwords.verifyPassword(newPassword,securedUser.passwordHash))throw new Error("Account consume services did not verify email, rotate password, and revoke the predecessor session.");

  const paidStart=DateTime.fromJSDate(start).plus({days:1}).toJSDate();
  const paid=await bookings.createBooking(`service-paid-${suffix}`,{startAt:paidStart.toISOString(),inviteeName:"Paid invitee",inviteeEmail:`paid-${suffix}@example.invalid`,inviteeTimeZone:"UTC",durationId:paidDurationId},`paid-${suffix}`,calendar,payments);
  const paidStored=await proof.booking.findUniqueOrThrow({where:{id:paid.booking.id}});
  if(!paidStored.stripeCheckoutSessionId)throw new Error(`Paid booking service did not persist its Checkout session binding ${JSON.stringify({priceCents:paidStored.priceCents,status:paidStored.status,checkoutUrl:paid.checkoutUrl})}`);
  const eventIdStripe=`evt_${suffix}`;const body=JSON.stringify({id:eventIdStripe,object:"event",api_version:"2025-07-30.basil",created:Math.floor(Date.now()/1000),livemode:false,pending_webhooks:1,type:"checkout.session.completed",data:{object:{id:paidStored.stripeCheckoutSessionId,object:"checkout.session",livemode:false,mode:"payment",status:"complete",payment_status:"paid",client_reference_id:paidStored.id,amount_total:paidStored.priceCents,currency:paidStored.currency,metadata:{bookingId:paidStored.id,eventTypeId:paidStored.eventTypeId,durationId:paidStored.durationId??""}}}});
  const signature=Stripe.webhooks.generateTestHeaderString({payload:body,secret:process.env.STRIPE_WEBHOOK_SECRET!});
  await paymentsService.processStripeWebhook(body,signature);

  const [freeRow,paidRow,recoveryCount,email,outbox,occupancy,invitation,accountTokens]=await Promise.all([
    proof.booking.findUniqueOrThrow({where:{id:free.booking.id}}),proof.booking.findUniqueOrThrow({where:{id:paid.booking.id}}),
    proof.bookingRecoveryToken.count({where:{bookingId:{in:[free.booking.id,paid.booking.id]}}}),proof.emailOutbox.count({where:{workspaceId}}),
    proof.integrationOutbox.count({where:{workspaceId}}),proof.bookingOccupancy.count({where:{bookingId:free.booking.id}}),
    proof.workspaceInvitation.count({where:{workspaceId,status:"PENDING"}}),proof.accountActionToken.count({where:{workspaceId}}),
  ]);
  if(freeRow.status!=="CANCELLED"||freeRow.cancellationReason!=="service proof"||paidRow.status!=="CONFIRMED"||paidRow.stripePaymentStatus!=="paid"||recoveryCount<3||email<7||outbox<4||occupancy!==0||invitation!==1||accountTokens!==4)throw new Error(`Service DML state mismatch ${JSON.stringify({recoveryCount,email,outbox,occupancy,invitation,accountTokens,free:freeRow.status,paid:paidRow.status})}`);
  console.log(JSON.stringify({serviceDml:true,flows:["public-free-booking","organizer-reschedule","organizer-cancel","invitation-write","password-reset-request-consume","email-verify-request-consume","stripe-provider-completion"],accountAuthorityReplayRejected:true,concurrentRecoverySerialized:true,predecessorSessionRevoked:true,recoveryCount,email,outbox}));
}finally{await proof.workspace.deleteMany({where:{id:workspaceId}}).catch(()=>undefined);await proof.user.deleteMany({where:{id:userId}}).catch(()=>undefined);await proof.$disconnect();}
