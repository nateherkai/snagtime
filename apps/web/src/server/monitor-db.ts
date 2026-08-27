import { createRequire } from "node:module";
import type { PrismaClient } from "@prisma/client";
import { db } from "@/server/db";

let monitor: PrismaClient | undefined;
export function monitorDb() {
  if (process.env.NODE_ENV !== "production") return db;
  const url = process.env.MONITOR_DATABASE_URL || "";
  if (!/^postgres(?:ql)?:\/\//.test(url) || !/[?&]sslmode=verify-full(?:&|$)/.test(url) || !/[?&]sslrootcert=[^&]+/.test(url)) throw new Error("Production monitor database requires verified PostgreSQL TLS and an explicit CA.");
  if (!monitor) { process.env.DATABASE_URL = url; const require = createRequire(import.meta.url); const generated = require("@tempocove/postgresql-client") as { PrismaClient: new () => PrismaClient }; monitor = new generated.PrismaClient(); }
  return monitor;
}
