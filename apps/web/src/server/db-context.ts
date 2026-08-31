import { AsyncLocalStorage } from "node:async_hooks";
import { createHmac } from "node:crypto";

export type DatabaseContext = { mode: "auth" | "bootstrap" | "federated" | "session" | "workspace" | "public" | "capability" | "provider"; workspaceId?: string; userId?: string; sessionHash?: string; subject?: string; action?: string };
type StoredContext = DatabaseContext & { transaction?: Record<string, unknown> };
export const databaseContext = new AsyncLocalStorage<StoredContext>();

function contextSecret() {
  const secret = process.env.TENANT_CONTEXT_SECRET || "";
  if (Buffer.byteLength(secret) < 32) throw new Error("TENANT_CONTEXT_SECRET must contain at least 32 bytes.");
  return secret;
}
function field(value?: string) { return value || ""; }
export function contextSignature(context: DatabaseContext) {
  return createHmac("sha256", contextSecret()).update(["v2",context.mode,field(context.workspaceId),field(context.userId),field(context.sessionHash),field(context.subject),field(context.action)].join("\0")).digest("hex");
}
export function enterDatabaseContext(context: DatabaseContext) {
  if (process.env.DATABASE_PROVIDER === "postgresql" && process.env.NODE_ENV === "production") databaseContext.enterWith(context);
}
export function enterAuthDatabaseContext(subject: string, userId?: string, workspaceId?: string, action = "auth") { enterDatabaseContext({ mode: "auth", subject: subject.toLowerCase(), userId, workspaceId,action }); }
export function enterBootstrapDatabaseContext(email: string, userId?: string, workspaceId?: string) { enterDatabaseContext({ mode: "bootstrap", workspaceId, userId, subject: [email.toLowerCase(),userId||"",workspaceId||""].join("|"),action:"register" }); }
export function enterPublicDatabaseContext(slug: string, workspaceId?: string, subject?: string) { enterDatabaseContext({ mode: "public", workspaceId, subject: subject || slug,action:"public_read" }); }
export function enterPublicBookingDatabaseContext(eventTypeId: string, workspaceId: string, idempotencyKey: string) { enterDatabaseContext({ mode: "public", workspaceId, subject: `${eventTypeId}|${idempotencyKey}`,action:"booking_create" }); }
export function enterCapabilityDatabaseContext(subject: string, userId?: string, workspaceId?: string, action = "capability") { enterDatabaseContext({ mode: "capability", subject, userId, workspaceId,action }); }
export function enterProviderDatabaseContext(subject: string, workspaceId?: string, action = "provider_commit") { enterDatabaseContext({ mode: "provider", subject, workspaceId,action }); }
export function enterDatabaseAction(action:string){
  const current=databaseContext.getStore();
  if(current)enterDatabaseContext({mode:current.mode,workspaceId:current.workspaceId,userId:current.userId,sessionHash:current.sessionHash,subject:current.subject,action});
}
export function currentDatabaseContext() { return databaseContext.getStore(); }
export async function installDatabaseContext(transaction: Record<string, unknown>, context: DatabaseContext) {
  const execute = transaction.$executeRawUnsafe as (query: string, ...values: unknown[]) => Promise<unknown>;
  await execute.call(transaction, "SELECT set_config('tempocove.mode',$1,true),set_config('tempocove.workspace_id',$2,true),set_config('tempocove.user_id',$3,true),set_config('tempocove.session_hash',$4,true),set_config('tempocove.subject',$5,true),set_config('tempocove.action',$6,true),set_config('tempocove.signature',$7,true)", context.mode, field(context.workspaceId), field(context.userId), field(context.sessionHash), field(context.subject),field(context.action), contextSignature(context));
}
