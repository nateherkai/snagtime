import * as healthModule from "../apps/web/src/server/health-db.ts";
const healthQuery=healthModule.healthQuery??(healthModule.default as typeof healthModule|undefined)?.healthQuery;
if(!healthQuery)throw new Error("The bounded health client did not load.");

const configured=process.env.DATABASE_URL||"";
if(!configured)throw new Error("DATABASE_URL is required for the health proof.");
const healthy=await healthQuery<{version:number}>("SELECT current_setting('server_version_num')::integer AS version");
if(Number(healthy[0]?.version)<180000)throw new Error("The bounded health client did not reach PostgreSQL 18.");
const unavailable=new URL(configured);unavailable.port="1";process.env.DATABASE_URL=unavailable.toString();const started=Date.now();let rejected=false;
try{await healthQuery("SELECT 1");}catch{rejected=true;}
const elapsed=Date.now()-started;if(!rejected||elapsed>=3_000)throw new Error(`Absent PostgreSQL did not fail closed below 3 seconds (${elapsed}ms).`);
process.env.DATABASE_URL=configured;
console.log(JSON.stringify({postgres18:true,absentRejected:true,elapsedBelowMs:3000}));
