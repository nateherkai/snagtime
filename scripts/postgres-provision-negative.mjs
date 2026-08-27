import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require=createRequire(import.meta.url);const {PrismaClient}=require("@tempocove/postgresql-client");const db=new PrismaClient({datasourceUrl:process.env.DATABASE_URL});
const roleNames=["tempocove_app_login","tempocove_worker_login","tempocove_monitor_login","tempocove_migration_login"];
try {
  const before=await db.$queryRawUnsafe("SELECT rolname,rolpassword FROM pg_authid WHERE rolname=ANY($1::text[]) ORDER BY rolname",roleNames);
  if(before.length!==roleNames.length)throw new Error("provisioning role inventory missing");
  const duplicate="Provision-Negative-Duplicate-Password-0000001";
  const child=spawnSync(process.execPath,[resolve("scripts/provision-postgres-logins.mjs")],{cwd:process.cwd(),encoding:"utf8",env:{...process.env,TENANT_CONTEXT_SECRET:"Provision-Negative-Context-Secret-00000001",TEMPOCOVE_APP_DB_PASSWORD:duplicate,TEMPOCOVE_WORKER_DB_PASSWORD:duplicate,TEMPOCOVE_MONITOR_DB_PASSWORD:"Provision-Negative-Monitor-Password-000001",TEMPOCOVE_MIGRATION_DB_PASSWORD:"Provision-Negative-Migration-Password-0001"}});
  if(child.status===0)throw new Error("invalid duplicate role credentials were accepted");
  const after=await db.$queryRawUnsafe("SELECT rolname,rolpassword FROM pg_authid WHERE rolname=ANY($1::text[]) ORDER BY rolname",roleNames);
  if(JSON.stringify(before)!==JSON.stringify(after))throw new Error("role passwords changed before complete credential validation");
  console.log("PostgreSQL provisioning validates all distinct credentials before any role mutation.");
} finally {await db.$disconnect();}
