import { randomUUID } from "node:crypto";

const SAFE_KEYS = new Set(["event","requestId","workerId","status","kind","attempted","pending","dead","durationMs","code"]);
function safeValue(value: unknown) { if (typeof value === "number" || typeof value === "boolean") return value; return String(value ?? "").replace(/[\r\n]/g, " ").slice(0, 160); }
export function structuredLog(level: "info" | "warn" | "error", fields: Record<string, unknown>) {
  const safe: Record<string, unknown> = { timestamp: new Date().toISOString(), level };
  for (const [key, value] of Object.entries(fields)) if (SAFE_KEYS.has(key)) safe[key] = safeValue(value);
  process.stdout.write(`${JSON.stringify(safe)}\n`);
}
export function requestId(value?: string | null) { return value && /^[0-9a-f-]{36}$/i.test(value) ? value : randomUUID(); }
