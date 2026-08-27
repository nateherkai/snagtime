import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const directory=mkdtempSync(join(tmpdir(),"tempocove-load-fixture-")),output=join(directory,"github-output.txt"),script=resolve("scripts/postgres-load-fixture.mjs");
const cleanEnv={GITHUB_OUTPUT:output,SystemRoot:process.env.SystemRoot||process.env.SYSTEMROOT||"",PATH:process.env.PATH||""};
const contract=spawnSync(process.execPath,[script,"--contract-test"],{env:cleanEnv,encoding:"utf8",stdio:["ignore","pipe","pipe"]});
if(contract.status!==0)throw new Error("Sanitized fixture contract execution failed.");
const lines=readFileSync(output,"utf8").trim().split(/\r?\n/),pairs=new Map(lines.map(line=>{const split=line.indexOf("=");return [line.slice(0,split),line.slice(split+1)];}));
const expected=["event_slug","duration_id","second_event_slug","second_duration_id","missing_event_slug","missing_duration_id","start_at"];
if(lines.length!==expected.length||expected.some(name=>!pairs.get(name))||pairs.get("missing_event_slug")===pairs.get("event_slug"))throw new Error("Fixture output roster or missing-credential identity is invalid.");
const absent=spawnSync(process.execPath,[script],{env:{SystemRoot:cleanEnv.SystemRoot,PATH:cleanEnv.PATH},encoding:"utf8",stdio:["ignore","ignore","ignore"]});
if(absent.status===0)throw new Error("Fixture unexpectedly accepted an ambient/missing configuration.");
console.log("Native load fixture sanitized-environment/output contract passed.");
