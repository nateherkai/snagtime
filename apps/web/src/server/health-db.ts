import { readFileSync } from "node:fs";
import { Client } from "pg";

export async function healthQuery<T extends Record<string,unknown>>(text:string,values:unknown[]=[]){
  const raw=process.env.DATABASE_URL||"",url=new URL(raw);if(url.protocol!=="postgresql:"&&url.protocol!=="postgres:")throw new Error("health database unavailable");const caPath=url.searchParams.get("sslrootcert"),insecureTest=(process.env.CI==="true"||process.env.NODE_ENV==="test")&&process.env.POSTGRES_INSECURE_LOCAL_TEST==="true"&&url.searchParams.get("sslmode")==="disable";if(!caPath&&!insecureTest)throw new Error("health CA unavailable");url.searchParams.delete("sslrootcert");url.searchParams.delete("sslmode");
  const client=new Client({connectionString:url.toString(),connectionTimeoutMillis:1500,query_timeout:1800,statement_timeout:1800,ssl:insecureTest?false:{rejectUnauthorized:true,ca:readFileSync(caPath!,"utf8")}});let timer:NodeJS.Timeout|undefined;
  try{await Promise.race([client.connect(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error("health connect timeout")),1800)})]);if(timer)clearTimeout(timer);const result=await Promise.race([client.query<T>(text,values),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error("health query timeout")),1800)})]);return result.rows;}
  finally{if(timer)clearTimeout(timer);const stream=(client as unknown as {connection?:{stream?:{destroy:()=>void}}}).connection?.stream;stream?.destroy();await client.end().catch(()=>undefined);}
}
