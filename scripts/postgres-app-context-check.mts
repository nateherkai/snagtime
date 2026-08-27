import * as dbModule from "../apps/web/src/server/db.ts";
import * as contextModule from "../apps/web/src/server/db-context.ts";
import * as eventModule from "../apps/web/src/server/services/event-types.ts";
import * as accountModule from "../apps/web/src/server/services/accounts.ts";
const db = dbModule.db ?? (dbModule.default as typeof dbModule | undefined)?.db;
const enterDatabaseContext = contextModule.enterDatabaseContext ?? (contextModule.default as typeof contextModule | undefined)?.enterDatabaseContext;
const enterAuthDatabaseContext = contextModule.enterAuthDatabaseContext ?? (contextModule.default as typeof contextModule | undefined)?.enterAuthDatabaseContext;
if(!db||!enterDatabaseContext||!enterAuthDatabaseContext)throw new Error("Application database context modules did not load.");

let workspaceId=process.env.TEST_WORKSPACE_ID||"",userId=process.env.TEST_USER_ID||""; let proofDb:{membership:{findFirstOrThrow:(args:unknown)=>Promise<{workspaceId:string;userId:string}>};$disconnect:()=>Promise<void>}|undefined;
if(!workspaceId||!userId){const proofUrl=process.env.PROOF_DATABASE_URL||"";if(!proofUrl)throw new Error("TEST_WORKSPACE_ID/TEST_USER_ID or PROOF_DATABASE_URL is required.");const require=(await import("node:module")).createRequire(import.meta.url);const {PrismaClient}=require("@tempocove/postgresql-client");proofDb=new PrismaClient({datasourceUrl:proofUrl});const membership=await proofDb!.membership.findFirstOrThrow({where:{status:"ACTIVE",role:"OWNER"}});workspaceId=membership.workspaceId;userId=membership.userId;}
try{
  enterDatabaseContext({mode:"workspace",workspaceId,userId,subject:"OWNER"});
  const rows=await db.workspace.findMany({select:{id:true}});
  if(rows.length!==1||rows[0]?.id!==workspaceId)throw new Error("Prisma transaction context did not isolate the expected workspace.");
  const members=await db.membership.count({where:{workspaceId}}); if(members<1)throw new Error("Prisma context did not resolve live membership.");
  const event=await db.eventType.findFirst({where:{workspaceId},select:{slug:true}}); if(!event)throw new Error("Imported event fixture missing.");
  const getEventTypeBySlug=eventModule.getEventTypeBySlug ?? (eventModule.default as typeof eventModule|undefined)?.getEventTypeBySlug; if(!getEventTypeBySlug)throw new Error("Public event service did not load.");
  const publicEvent=await getEventTypeBySlug(event.slug); if(!publicEvent.durations.length||!publicEvent.owner||!publicEvent.workspace)throw new Error("Public RLS graph omitted required event children.");
  const registerAccount=accountModule.registerAccount ?? (accountModule.default as typeof accountModule|undefined)?.registerAccount; if(!registerAccount)throw new Error("Account service did not load.");
  const registrationEmail=`rls-registration-${Date.now()}@example.invalid`; await registerAccount({name:"RLS Registration",email:registrationEmail,password:"Native!Registration2026",workspaceName:"RLS registration",timeZone:"UTC"});
  enterAuthDatabaseContext(registrationEmail); const registered=await db.user.count({where:{email:registrationEmail}}); if(registered!==1)throw new Error("Signed bootstrap context did not create an isolated account graph.");
  console.log(JSON.stringify({prismaContext:true,workspaceRows:rows.length,members,publicGraph:true,bootstrapGraph:true}));
}finally{await Promise.allSettled([db.$disconnect(),proofDb?.$disconnect()]);}
