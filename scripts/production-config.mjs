const mode = process.argv[2] || "runtime"; const errors = []; const databaseRole = process.env.DATABASE_ROLE || "app"; const runtimeDatabaseName = databaseRole === "worker" ? "WORKER_DATABASE_URL" : "DATABASE_URL";
const required = mode === "migration" ? ["DATABASE_URL","DATABASE_PROVIDER"] : [runtimeDatabaseName,"DATABASE_PROVIDER","NEXT_PUBLIC_APP_URL","TOKEN_ENCRYPTION_KEY","EMAIL_TOKEN_SECRET","GOOGLE_CLIENT_ID","GOOGLE_CLIENT_SECRET","STRIPE_SECRET_KEY","BUILD_ID"];
if (mode !== "migration" && databaseRole === "app") required.push("AUTH_SECRET","BOOKING_CAPABILITY_KEY_ID","BOOKING_CAPABILITY_SECRET","TENANT_CONTEXT_SECRET","RATE_LIMIT_HASH_SECRET","STRIPE_WEBHOOK_SECRET","PROXY_SHARED_SECRET","OPERATOR_HEALTH_SECRET");
for (const name of required) if (!process.env[name]) errors.push(`${name} is required`);
if (process.env.DATABASE_PROVIDER !== "postgresql" || !/^postgres(?:ql)?:\/\//.test(process.env[runtimeDatabaseName] || "")) errors.push("role-specific PostgreSQL is required");
if (!/[?&]sslmode=verify-full(?:&|$)/.test(process.env[runtimeDatabaseName] || "") || !/[?&]sslrootcert=[^&]+/.test(process.env[runtimeDatabaseName] || "")) errors.push("PostgreSQL TLS verification with explicit CA is required");
if(mode!=="migration"&&(!/[?&]connect_timeout=[1-5](?:&|$)/.test(process.env[runtimeDatabaseName]||"")||!/[?&]pool_timeout=(?:1[5-9]|2\d|30)(?:&|$)/.test(process.env[runtimeDatabaseName]||"")||!/[?&]connection_limit=(?:1\d|[2-4]\d|50)(?:&|$)/.test(process.env[runtimeDatabaseName]||"")||!/[?&]statement_timeout=(?:[5-9]\d{2}|[12]\d{3}|3000)(?:&|$)/.test(process.env[runtimeDatabaseName]||"")))errors.push("bounded PostgreSQL connect, pool, statement, and concurrency posture is required");
if (mode !== "migration") {
  if (!/^[A-Fa-f0-9]{40,64}$/.test(process.env.BUILD_ID || "")) errors.push("immutable hexadecimal build identity required");
  try { const origin = new URL(process.env.NEXT_PUBLIC_APP_URL || ""); if (origin.protocol !== "https:" || origin.pathname !== "/" || origin.search || origin.hash || origin.username || origin.password) errors.push("canonical HTTPS origin required"); } catch { errors.push("canonical HTTPS origin required"); }
  for (const name of ["EMAIL_TOKEN_SECRET",...(databaseRole === "app" ? ["RATE_LIMIT_HASH_SECRET","AUTH_SECRET","BOOKING_CAPABILITY_SECRET","PROXY_SHARED_SECRET","OPERATOR_HEALTH_SECRET"] : [])]) if (Buffer.byteLength(process.env[name] || "") < 32) errors.push(`${name} must contain at least 32 bytes`);
  if (databaseRole === "app" && !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(process.env.BOOKING_CAPABILITY_KEY_ID || "")) errors.push("BOOKING_CAPABILITY_KEY_ID is invalid");
  if (databaseRole === "app" && process.env.BOOKING_CAPABILITY_SECRET === process.env.AUTH_SECRET) errors.push("BOOKING_CAPABILITY_SECRET must be independent from AUTH_SECRET");
}
if (mode !== "migration") {
  if (databaseRole === "app" && process.env.RATE_LIMIT_PROVIDER !== "postgresql") errors.push("distributed PostgreSQL limiter required");
  if (databaseRole === "app" && Buffer.byteLength(process.env.TENANT_CONTEXT_SECRET || "") < 32) errors.push("strong tenant context secret required");
  if (!/^[0-9A-Fa-f]{64}$/.test(process.env.TOKEN_ENCRYPTION_KEY || "") || new Set(Buffer.from(process.env.TOKEN_ENCRYPTION_KEY || "", "hex")).size < 16) errors.push("diverse token encryption key required");
  if (process.env.OUTBOX_WORKER_MODE !== "dedicated") errors.push("dedicated worker required");
  if (databaseRole === "app" && process.env.TRUST_PROXY !== "true") errors.push("trusted ingress required");
  if (process.env.DEMO_MODE === "true" || process.env.EMAIL_PROVIDER !== "smtp" || process.env.CALENDAR_PROVIDER !== "google" || process.env.PAYMENTS_PROVIDER !== "stripe") errors.push("demo/local providers forbidden");
  if (!["implicit","starttls"].includes(process.env.SMTP_TLS_MODE || "")) errors.push("TLS SMTP mode required");
  if (!process.env.GOOGLE_CLIENT_ID?.endsWith(".apps.googleusercontent.com") || Buffer.byteLength(process.env.GOOGLE_CLIENT_SECRET || "") < 16) errors.push("Google OAuth configuration incomplete");
  if (!process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_") || (databaseRole === "app" && !process.env.STRIPE_WEBHOOK_SECRET?.startsWith("whsec_"))) errors.push("Stripe test configuration incomplete");
  const senderDomain = (process.env.EMAIL_SENDER_DOMAIN || "").toLowerCase(); const mailbox = (process.env.EMAIL_FROM || "").match(/<([^<>]+)>$/)?.[1] || process.env.EMAIL_FROM || "";
  if (!process.env.EMAIL_REPLY_TO || !senderDomain || !mailbox.toLowerCase().endsWith(`@${senderDomain}`)) errors.push("system email sender and Reply-To contract incomplete");
}
if (errors.length) { console.error(`Production configuration rejected (${errors.length} invariant violations).`); process.exit(1); }
console.log(`Production ${mode} configuration contract passed without printing values.`);
