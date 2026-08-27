import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

const sourcePath = process.env.SQLITE_SOURCE_PATH || ""; const targetUrl = process.env.DATABASE_URL || "";
if (!isAbsolute(sourcePath)) throw new Error("SQLITE_SOURCE_PATH must be an absolute frozen SQLite file.");
if (!/^postgres(?:ql)?:\/\//.test(targetUrl)) throw new Error("DATABASE_URL must target PostgreSQL.");
const localException = process.env.NODE_ENV === "test" && process.env.POSTGRES_INSECURE_LOCAL_TEST === "true";
if ((!/[?&]sslmode=verify-full(?:&|$)/.test(targetUrl) || !/[?&]sslrootcert=[^&]+/.test(targetUrl)) && !localException) throw new Error("PostgreSQL import requires verified TLS and an explicit CA.");
if (process.env.CONFIRM_EMPTY_POSTGRES_IMPORT !== "true") throw new Error("Set CONFIRM_EMPTY_POSTGRES_IMPORT=true only for a verified empty target.");

const require = createRequire(import.meta.url); const { PrismaClient: SqliteClient } = require("@prisma/client"); const { PrismaClient: PostgresClient, Prisma } = require("@tempocove/postgresql-client");
const frozenSource=resolve(sourcePath); const source = new SqliteClient({ datasourceUrl: `file:${frozenSource.replaceAll("\\", "/")}?mode=ro&immutable=1` }); const target = new PostgresClient({ datasourceUrl: targetUrl });
const models = ["user","workspace","membership","workspaceInvitation","eventType","eventDuration","customQuestion","availabilitySchedule","availabilityInterval","availabilityOverride","workspaceBranding","booking","bookingAnswer","bookingOccupancy","bookingCapability","bookingManageSession","integrationOutbox","accountActionToken","bookingRecoveryToken","emailOutbox","localInboxMessage","authSession","oAuthState","oAuthConnection","webhookEvent","rateLimitBucket","workerHeartbeat"];
const canonical = (value) => JSON.stringify(value, (_key, item) => item instanceof Date ? item.toISOString() : typeof item === "bigint" ? item.toString() : Buffer.isBuffer(item) ? item.toString("base64") : item);
const digest = (rows) => createHash("sha256").update(rows.map(canonical).sort().join("\n"), "utf8").digest("hex").toUpperCase();
function sourceSnapshot(){return [frozenSource,`${frozenSource}-wal`,`${frozenSource}-shm`].map(path=>existsSync(path)?{path:path.slice(frozenSource.length),bytes:statSync(path).size,sha256:createHash("sha256").update(readFileSync(path)).digest("hex").toUpperCase()}:{path:path.slice(frozenSource.length),missing:true});}

try {
  const before=sourceSnapshot(); const sourceRows = await source.$transaction(async tx=>{const rows=new Map();for(const model of models)rows.set(model,await tx[model].findMany());return rows;},{timeout:120_000});const sourceDelay=process.env.NODE_ENV==="test"?Number(process.env.IMPORT_TEST_SOURCE_DELAY_MS||0):0;if(sourceDelay>0)await new Promise(resolve=>setTimeout(resolve,Math.min(sourceDelay,5_000))); const after=sourceSnapshot();
  if(JSON.stringify(before)!==JSON.stringify(after))throw new Error("SQLite source changed during the immutable snapshot.");
  await target.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(860217452)");
    for (const model of models) if (await tx[model].count() !== 0) throw new Error(`PostgreSQL target is not empty at ${model}.`);
    for (const model of models) {
      const rows = sourceRows.get(model); for (let offset = 0; offset < rows.length; offset += 250) await tx[model].createMany({ data: rows.slice(offset, offset + 250) });
    }
  }, { timeout: 120_000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  const inventory = [];
  for (const model of models) { const left = sourceRows.get(model); const right = await target[model].findMany(); const sourceSha256 = digest(left); const targetSha256 = digest(right); if (left.length !== right.length || sourceSha256 !== targetSha256) throw new Error(`SQLite/PostgreSQL reconciliation failed at ${model}.`); inventory.push({ model, count: left.length, sha256: sourceSha256 }); }
  const aggregateSha256 = createHash("sha256").update(JSON.stringify(inventory), "utf8").digest("hex").toUpperCase();
  console.log(JSON.stringify({ imported: true, immutableSource: true, sourceFiles: before, models: inventory.length, rows: inventory.reduce((sum, item) => sum + item.count, 0), aggregateSha256 }));
} finally { await Promise.allSettled([source.$disconnect(), target.$disconnect()]); }
