"use client";

import { useEffect, useState } from "react";
import type { LocalInboxMessage } from "@/lib/contracts";
import { frontendApi } from "./api-adapter";
import { Icon } from "./icons";
import { ActionButton, Badge, PageHeader } from "./ui";
import { useWorkspaceAccess } from "./workspace-access";

type IntegrationStatus = Awaited<ReturnType<typeof frontendApi.getIntegrationStatus>>;
function inboxAction(message: LocalInboxMessage) { const match = message.text.match(/https?:\/\/\S+/); if (!match) return null; try { const url = new URL(match[0]); const label = url.pathname === "/verify-email" ? "Verify email" : url.pathname === "/reset-password" ? "Reset password" : url.pathname === "/invite/accept" ? "Accept invitation" : url.pathname.includes("/manage/") ? "Open booking management" : "Open action"; return { href: url.toString(), label }; } catch { return null; } }
function GoogleCalendarLogo() { return <svg viewBox="0 0 40 40" aria-hidden="true"><rect x="3" y="3" width="34" height="34" rx="7" fill="#fff"/><path fill="#4285f4" d="M3 12h34v18l-7 7H10a7 7 0 0 1-7-7V12Z"/><path fill="#34a853" d="M3 25h12v12h-5a7 7 0 0 1-7-7v-5Z"/><path fill="#fbbc04" d="M30 25h7v5a7 7 0 0 1-7 7v-12Z"/><path fill="#ea4335" d="M10 3h20a7 7 0 0 1 7 7v3H3v-3a7 7 0 0 1 7-7Z"/><text x="20" y="28" textAnchor="middle" fill="#fff" fontSize="15" fontWeight="800" fontFamily="Arial,sans-serif">31</text></svg>; }
function StripeLogo() { return <svg viewBox="0 0 40 40" aria-hidden="true"><rect width="40" height="40" rx="8" fill="#635bff"/><text x="20" y="24" textAnchor="middle" fill="#fff" fontSize="10.5" fontWeight="800" fontStyle="italic" fontFamily="Arial,sans-serif">stripe</text></svg>; }
function DeliveryLogo() { return <svg viewBox="0 0 40 40" aria-hidden="true"><rect width="40" height="40" rx="8" fill="#123f46"/><path d="M10.5 13.5h19v14h-19z" fill="none" stroke="#fff" strokeWidth="2" strokeLinejoin="round"/><path d="m11.5 15 8.5 7 8.5-7" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><circle cx="30" cy="10" r="4" fill="#78d4c3"/></svg>; }

export function IntegrationsView() {
  const { canManage } = useWorkspaceAccess();
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [inbox, setInbox] = useState<LocalInboxMessage[] | null>(null);
  const [retryingEmail, setRetryingEmail] = useState(false);
  const load = () => frontendApi.getIntegrationStatus().then(setStatus).catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load integration status.")).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);
  useEffect(() => { frontendApi.listLocalEmailInbox().then(setInbox).catch(() => setInbox(null)); }, []);
  const connect = async () => {
    setWorking(true); setError("");
    try {
      const response = await fetch(frontendApi.googleAuthorizePath, { method: "POST", credentials: "same-origin", headers: { accept: "application/json" } });
      const body = await response.json() as { data?: { authorizationUrl?: string }; error?: { message?: string } };
      const authorizationUrl = body.data?.authorizationUrl;
      if (!response.ok || !authorizationUrl) throw new Error(body.error?.message || "Google authorization could not start.");
      window.location.assign(authorizationUrl);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Google authorization could not start."); setWorking(false); }
  };
  const disconnect = async () => {
    setWorking(true); setError("");
    try { await frontendApi.disconnectGoogle(); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not disconnect Google Calendar."); }
    finally { setWorking(false); }
  };
  const retryEmail = async () => { setRetryingEmail(true); setError(""); try { await frontendApi.retryEmailOutbox(); setInbox(await frontendApi.listLocalEmailInbox()); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not retry the local email outbox."); } finally { setRetryingEmail(false); } };
  const google = status?.google ?? null;
  const stripe = status?.stripe ?? null;
  const outboxWorker = status?.outboxWorker ?? null;
  const localFallback = Boolean(google && google.requestedProvider === "google" && google.provider === "local");
  const reconnectRequired = Boolean(google && google.requestedProvider === "google" && google.scopeHealth === "insufficient");
  const googleUnavailable = Boolean(google && google.requestedProvider === "google" && google.scopeHealth === "unavailable");
  return <div className="page-stack">
    <PageHeader title="Integrations" description="Connect the services that power scheduling, payments, and delivery." />
    {loading && <div className="sync-note" role="status"><span className="spinner" />Loading integrations…</div>}
    {error && <div className="toast toast-error" role="alert"><span><Icon name="x" /></span>{error}</div>}
    <div className="integration-groups"><section><div className="group-title"><h2>Calendar</h2><span>1 integration</span></div><div className="integration-grid">
      <article className="integration-card"><div className="integration-mark mark-google"><GoogleCalendarLogo /></div><div className="integration-copy"><div><h3>Google Calendar</h3>{google && <Badge tone={google.disconnectPending || reconnectRequired || googleUnavailable || localFallback ? "warning" : google.connected ? "success" : google.configured ? "neutral" : "warning"} dot>{google.disconnectPending ? "Disconnect pending" : reconnectRequired ? "Reconnect required" : googleUnavailable ? "Unavailable" : localFallback ? "Disconnected" : google.connected ? "Connected" : google.configured ? "Available" : "Not configured"}</Badge>}</div><p>{google?.connected && google.provider === "google" ? "Conflict checking and booking updates are ready." : reconnectRequired ? "Reconnect Google Calendar to restore conflict checking and event updates." : googleUnavailable ? "Google Calendar could not be reached. New bookings will pause until access is restored." : localFallback ? "Connect Google Calendar to check conflicts and add events automatically." : "Connect Google Calendar to keep availability and events in sync."}</p>{google && <span className="integration-detail">{google.connected ? `${google.calendarId} calendar · ${google.scopeHealth === "complete" ? "Full calendar access" : "Access needs attention"}` : google.missingScopes.length ? `${google.missingScopes.length} permission${google.missingScopes.length === 1 ? "" : "s"} needed` : "No calendar connected"}</span>}</div>{canManage && (google?.disconnectPending ? <ActionButton variant="secondary" disabled>Disconnect pending</ActionButton> : google?.connected ? google.disconnectSupported ? <ActionButton variant="secondary" onClick={disconnect} disabled={working}>{working ? "Disconnecting…" : "Disconnect"}</ActionButton> : <Badge tone="neutral">Managed externally</Badge> : <ActionButton variant="primary" onClick={connect} disabled={working || !google?.configured}>{working ? "Opening…" : reconnectRequired ? "Reconnect" : "Connect"}</ActionButton>)}</article>
    </div></section><section><div className="group-title"><h2>Payments</h2><span>Test checkout</span></div><div className="integration-grid"><article className="integration-card"><div className="integration-mark mark-stripe"><StripeLogo /></div><div className="integration-copy"><div><h3>Stripe</h3>{stripe && <Badge tone={stripe.configured ? "success" : "warning"} dot>{stripe.configured ? "Test mode ready" : "Setup needed"}</Badge>}</div><p>{stripe?.configured ? "Test checkout is ready for paid event types." : "Add your Stripe test credentials before publishing paid event types."}</p>{stripe && <span className="integration-detail">{stripe.mode === "test" ? "Test payments only" : stripe.mode}</span>}</div></article></div></section>
    <section><div className="group-title"><h2>Delivery</h2><span>Background processing</span></div><div className="integration-grid"><article className="integration-card"><div className="integration-mark mark-worker"><DeliveryLogo /></div><div className="integration-copy"><div><h3>Booking delivery</h3>{outboxWorker && <Badge tone={outboxWorker.enabled ? "success" : "warning"} dot>{outboxWorker.enabled ? "Running" : "Paused"}</Badge>}</div><p>{outboxWorker?.enabled ? "Calendar changes and booking emails are processed in the background." : "Background delivery is paused. Pending updates will wait until it is enabled."}</p></div></article></div></section>{inbox && <section><div className="group-title"><h2>Demo inbox</h2><span>Local preview</span></div><div className="panel local-inbox"><div className="settings-heading"><div><h3>Email previews</h3><p>Preview the emails generated by this local demo without sending them externally.</p></div>{canManage && <ActionButton variant="secondary" onClick={retryEmail} disabled={retryingEmail}>{retryingEmail ? "Retrying…" : "Retry pending"}</ActionButton>}</div><div className="inbox-list">{inbox.map((message) => { const action = inboxAction(message); return <article className="inbox-message" key={message.id}><div><strong>{message.subject}</strong><span>{message.recipientEmail} · {new Date(message.createdAt).toLocaleString()}</span></div>{action ? <button className="button button-secondary button-sm" type="button" onClick={() => window.location.assign(action.href)}>{action.label}</button> : <Badge tone="neutral">No action</Badge>}</article>; })}{inbox.length === 0 && <p className="muted">No email previews yet.</p>}</div></div></section>}</div>
  </div>;
}
