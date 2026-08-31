import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import type { PrismaClient } from "@prisma/client";
import { currentDatabaseContext, databaseContext, installDatabaseContext } from "@/server/db-context";
import { boundedPrismaTransactionOptions, currentDatabaseTransactionBudgetMs } from "@/server/database-retry";

function defaultDatabaseUrl() {
  const repositoryRoot = existsSync(resolve(process.cwd(), "prisma", "schema.prisma"))
    ? process.cwd()
    : resolve(process.cwd(), "..", "..");
  return `file:${resolve(repositoryRoot, "prisma", "dev.db").replaceAll("\\", "/")}`;
}
function hasBoundedPostgresRuntime(url:string){return /[?&]connect_timeout=[1-5](?:&|$)/.test(url)&&/[?&]pool_timeout=(?:1[5-9]|2\d|30)(?:&|$)/.test(url)&&/[?&]connection_limit=(?:1\d|[2-4]\d|50)(?:&|$)/.test(url)&&/[?&]statement_timeout=(?:[5-9]\d{2}|[12]\d{3}|3000)(?:&|$)/.test(url);}

const productionTransactionOptions = { maxWait: 15_000, timeout: 30_000 } as const;
function contextualTransactionOptions(options?: unknown) {
  if (process.env.DATABASE_PROVIDER !== "postgresql" || process.env.NODE_ENV !== "production") return options;
  const requested = options && typeof options === "object" ? { ...productionTransactionOptions, ...options } : productionTransactionOptions;
  const remaining = currentDatabaseTransactionBudgetMs();
  return remaining === undefined ? requested : { ...requested, ...boundedPrismaTransactionOptions(remaining, requested) };
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createDatabaseClient() {
  const provider = process.env.DATABASE_PROVIDER || "sqlite"; const productionRuntime = process.env.NODE_ENV === "production" && process.env.NEXT_PHASE !== "phase-production-build";
  if (productionRuntime && provider !== "postgresql") throw new Error("Production requires DATABASE_PROVIDER=postgresql; SQLite fallback is disabled.");
  if (provider === "postgresql") {
    const role = process.env.DATABASE_ROLE || "app"; const url = role === "worker" ? process.env.WORKER_DATABASE_URL || "" : process.env.DATABASE_URL || "";
    if (role !== "app" && role !== "worker") throw new Error("DATABASE_ROLE must be app or worker.");
    const localTestTlsException = (process.env.NODE_ENV === "test" || process.env.CI === "true") && process.env.POSTGRES_INSECURE_LOCAL_TEST === "true";
    if (!/^postgres(?:ql)?:\/\//.test(url) || ((!/[?&]sslmode=verify-full(?:&|$)/.test(url) || !/[?&]sslrootcert=[^&]+/.test(url)) && !localTestTlsException) || (productionRuntime&&!hasBoundedPostgresRuntime(url))) throw new Error("PostgreSQL runtime requires the role-specific verified-TLS URL with bounded connect, pool, and statement timeouts.");
    process.env.DATABASE_URL = url;
    const require = createRequire(import.meta.url); const generated = require("@tempocove/postgresql-client") as { PrismaClient: new () => PrismaClient };
    return new generated.PrismaClient();
  }
  if (provider !== "sqlite") throw new Error("DATABASE_PROVIDER must be sqlite or postgresql.");
  process.env.DATABASE_URL = process.env.DATABASE_URL || defaultDatabaseUrl();
  const require = createRequire(import.meta.url); const local = require("@prisma/client") as { PrismaClient: new () => PrismaClient };
  return new local.PrismaClient();
}

const baseDb = globalForPrisma.prisma ?? createDatabaseClient();
const modelNames = new Set(["user","workspace","membership","workspaceInvitation","eventType","eventDuration","customQuestion","availabilitySchedule","availabilityInterval","availabilityOverride","workspaceBranding","booking","bookingAnswer","bookingOccupancy","bookingCapability","bookingManageSession","integrationOutbox","accountActionToken","bookingRecoveryToken","emailOutbox","localInboxMessage","authSession","oAuthState","oAuthConnection","webhookEvent","rateLimitBucket","workerHeartbeat","councilForgeSsoReplay"]);
function contextualClient(client: PrismaClient) {
  if (process.env.DATABASE_PROVIDER !== "postgresql" || process.env.NODE_ENV !== "production" || process.env.DATABASE_ROLE === "worker") return client;
  return new Proxy(client as unknown as Record<string, unknown>, { get(target, property) {
    const stored = currentDatabaseContext(); const name = String(property);
    if (stored?.transaction && name in stored.transaction) { const value = stored.transaction[name]; return typeof value === "function" ? value.bind(stored.transaction) : value; }
    const value = target[name];
    if (name === "$transaction" && typeof value === "function") return async (operation: unknown, options?: unknown) => {
      if (typeof operation !== "function") return (value as (...args: unknown[]) => unknown).call(target, operation, options);
      if (stored?.transaction) return operation(stored.transaction);
      if (!stored) return (value as (...args: unknown[]) => unknown).call(target, operation, options);
      return (value as (callback: (tx: Record<string, unknown>) => Promise<unknown>, options?: unknown) => Promise<unknown>).call(target, async (tx) => { await installDatabaseContext(tx, stored); return databaseContext.run({ ...stored, transaction: tx }, () => operation(tx)); }, contextualTransactionOptions(options));
    };
    if (!stored) return typeof value === "function" ? value.bind(target) : value;
    if (modelNames.has(name) && value && typeof value === "object") return new Proxy(value as Record<string, unknown>, { get(delegate, method) { const member = delegate[String(method)]; if (typeof member !== "function") return member; return (...args: unknown[]) => (target.$transaction as (callback: (tx: Record<string, unknown>) => Promise<unknown>, options?: unknown) => Promise<unknown>)(async (tx) => { await installDatabaseContext(tx, stored); const operation = (tx[name] as Record<string, (...inner: unknown[]) => unknown>)[String(method)]; if (!operation) throw new Error(`Unknown database operation ${name}.${String(method)}`); return databaseContext.run({ ...stored, transaction: tx }, () => operation(...args)); }, contextualTransactionOptions()); } });
    if (["$queryRaw","$queryRawUnsafe","$executeRaw","$executeRawUnsafe"].includes(name) && typeof value === "function") return (...args: unknown[]) => (target.$transaction as (callback: (tx: Record<string, unknown>) => Promise<unknown>, options?: unknown) => Promise<unknown>)(async (tx) => { await installDatabaseContext(tx, stored); return databaseContext.run({ ...stored, transaction: tx }, () => (tx[name] as (...inner: unknown[]) => unknown)(...args)); }, contextualTransactionOptions());
    return typeof value === "function" ? value.bind(target) : value;
  } }) as unknown as PrismaClient;
}

export const db = contextualClient(baseDb);

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = baseDb;
