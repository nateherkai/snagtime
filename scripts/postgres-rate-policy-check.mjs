import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";

const root=process.cwd();
const files=(await import("node:fs")).readdirSync(resolve(root,"apps/web/src/app/api"),{recursive:true})
  .filter((name)=>String(name).endsWith(".ts"));
const pairs=new Set();
for(const name of files){
  const source=readFileSync(resolve(root,"apps/web/src/app/api",String(name)),"utf8");
  for(const match of source.matchAll(/enforceRateLimit\([^,\n]+,\s*([^,\n]+),\s*([^\)\n]+)\)/g)){
    const evaluate=(expression)=>{if(!/^[\d\s*+_-]+$/.test(expression))throw new Error(`Nonliteral rate policy in ${name}: ${expression}`);return Function(`"use strict";return (${expression})`)()};
    pairs.add(`${evaluate(match[1])}|${evaluate(match[2])}`);
  }
}
const require=createRequire(import.meta.url);const {PrismaClient}=require("@tempocove/postgresql-client");
if(!process.env.PROOF_DATABASE_URL)throw new Error("PROOF_DATABASE_URL is required for the owner-authorized rate-policy inventory proof.");
const db=new PrismaClient({datasourceUrl:process.env.PROOF_DATABASE_URL});
try{
  const rows=await db.$queryRawUnsafe("SELECT limit_value,window_ms FROM tempocove_rate_policy ORDER BY limit_value,window_ms");
  const inventory=new Set(rows.map((row)=>`${Number(row.limit_value)}|${Number(row.window_ms)}`));
  const missing=[...pairs].filter((pair)=>!inventory.has(pair));
  const unused=[...inventory].filter((pair)=>!pairs.has(pair));
  if(missing.length||unused.length)throw new Error(`Rate policy/source mismatch missing=${missing.join(",")||"none"} unused=${unused.join(",")||"none"}`);
  console.log(JSON.stringify({ratePolicies:[...pairs].sort(),sourceCallSites:files.length,exactInventory:true}));
}finally{await db.$disconnect();}
