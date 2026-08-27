"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DurationOption, EventType } from "./demo-data";
import { frontendApi } from "./api-adapter";
import { foregroundForBackground } from "./brand-contrast";
import { Icon } from "./icons";
import { ActionButton, Badge, Field, Toggle } from "./ui";
import { useWorkspaceAccess } from "./workspace-access";

const defaultEvent: EventType = {
  id: "new", title: "", slug: "", description: "", color: "#2563eb", status: "draft", location: "Google Meet",
  locationType: "GOOGLE_MEET", locationValue: null,
  durations: [{ minutes: 30, label: "30 min", isDefault: true, currency: "USD" }], questions: [],
  bookingWindowDays: 60, bufferBeforeMinutes: 15, bufferAfterMinutes: 15, minimumNoticeMinutes: 240,
  bookingCount: 0, hostName: "",
};

const tabs = ["Basics", "Availability", "Questions"] as const;

export function EventTypeEditor({ eventId, mode = "edit" }: { eventId?: string; mode?: "edit" | "create" }) {
  const router = useRouter();
  const { canManage } = useWorkspaceAccess();
  const [event, setEvent] = useState(defaultEvent);
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]>("Basics");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [loading, setLoading] = useState(mode === "edit");
  const [loaded, setLoaded] = useState(mode === "create");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [persistedSlug, setPersistedSlug] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const revision = useRef(0);
  const isPaid = event.durations.some((duration) => duration.price);
  const currency = event.durations.find((duration) => duration.price)?.currency ?? event.durations[0]?.currency ?? "USD";
  const publicUrl = `/book/${event.slug || "your-link"}`;
  const locationComplete = event.locationType === "GOOGLE_MEET" || Boolean(event.locationValue?.trim());

  useEffect(() => {
    if (mode !== "edit" || !eventId) return;
    let active = true;
    const startingRevision = revision.current;
    frontendApi.getEventType(eventId).then((item) => {
      if (!active || revision.current !== startingRevision) return;
      setEvent(item);
      setPersistedSlug(item.status === "published" && item.slug ? item.slug : null);
      setLoaded(true);
    }).catch((reason) => { if (active) setSaveError(reason instanceof Error ? reason.message : "Could not load this event type."); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [eventId, loadAttempt, mode]);

  const update = <K extends keyof EventType>(key: K, value: EventType[K]) => { if (!loaded) return; revision.current += 1; setSaved(false); setEvent((item) => ({ ...item, [key]: value })); };
  const updateDuration = (index: number, patch: Partial<DurationOption>) => update("durations", event.durations.map((item, i) => i === index ? { ...item, ...patch, label: patch.minutes ? `${patch.minutes} min` : item.label } : patch.isDefault ? { ...item, isDefault: false } : item));
  const addDuration = () => update("durations", [...event.durations, { minutes: 60, label: "60 min", isDefault: false, currency }]);
  const canPublish = Boolean(event.title.trim() && event.slug.trim() && event.durations.length > 0 && locationComplete && (!isPaid || currency));
  const completion = useMemo(() => [Boolean(event.title), Boolean(event.slug), event.durations.length > 0, locationComplete].filter(Boolean).length, [event.title, event.slug, event.durations.length, locationComplete]);
  const moveTab = (tab: (typeof tabs)[number], direction: -1 | 1) => { const index = tabs.indexOf(tab); const next = tabs[(index + direction + tabs.length) % tabs.length]!; setActiveTab(next); window.requestAnimationFrame(() => document.getElementById(`event-tab-${next.toLowerCase()}`)?.focus()); };

  async function save(publish = false) {
    if (!loaded) return;
    setSaving(true); setSaveError("");
    const savingRevision = revision.current;
    const next = { ...event, status: publish ? "published" as const : event.status };
    try {
      const persisted = await frontendApi.saveEventType(next, mode, publish);
      setPersistedSlug(persisted.status === "published" && persisted.slug ? persisted.slug : null);
      if (revision.current === savingRevision) {
        setEvent(persisted);
        revision.current += 1;
        setSaved(true);
        window.setTimeout(() => setSaved(false), 2600);
      }
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not save this event type.");
    } finally { setSaving(false); }
  }

  async function remove() {
    if (mode !== "edit" || !eventId || deleting) return;
    if (!window.confirm(`Delete “${event.title || "this event type"}”? Existing bookings remain in history, but its public booking page will stop accepting bookings.`)) return;
    setDeleting(true); setSaveError("");
    try { await frontendApi.deleteEventType(eventId); router.replace("/event-types"); }
    catch (reason) { setSaveError(reason instanceof Error ? reason.message : "Could not delete this event type."); setDeleting(false); }
  }

  if (!canManage) return <div className="editor-page"><section className="empty-state" role="alert"><span className="empty-icon"><Icon name="x" /></span><h1>Organizer access required</h1><p>Your workspace role cannot create or change event types.</p><Link href="/dashboard" className="button button-secondary">Back to dashboard</Link></section></div>;
  if (mode === "edit" && loading) return <div className="editor-page"><div className="sync-note" role="status"><span className="spinner" />Loading event type…</div></div>;
  if (mode === "edit" && !loaded) return <div className="editor-page"><section className="empty-state" role="alert"><span className="empty-icon"><Icon name="x" /></span><h1>Event type unavailable</h1><p>{saveError || "This event type could not be loaded."}</p><ActionButton variant="primary" onClick={() => { setLoading(true); setSaveError(""); setLoadAttempt((attempt) => attempt + 1); }}>Retry</ActionButton><Link href="/event-types" className="button button-secondary">Back to event types</Link></section></div>;

  return <div className="editor-page">
    <header className="editor-topbar">
      <div className="editor-title"><Link href="/event-types" className="icon-button" aria-label="Back to event types"><Icon name="arrow-left" /></Link><div><span>{mode === "create" ? "New event type" : "Editing event type"}</span><strong>{event.title || "Untitled event"}</strong></div><Badge tone={event.status === "published" ? "success" : "neutral"} dot>{event.status}</Badge></div>
      <div className="editor-actions">{mode === "edit" && <ActionButton onClick={() => void remove()} variant="danger" disabled={deleting || saving}>{deleting ? "Deleting…" : "Delete"}</ActionButton>}{persistedSlug ? <Link href={`/book/${persistedSlug}`} className="button button-secondary"><Icon name="external" size={16} />Preview published page</Link> : <button type="button" className="button button-secondary" disabled title="Save and publish this event before previewing"><Icon name="external" size={16} />Preview unavailable</button>}{event.status !== "published" && <ActionButton onClick={() => save(false)} variant="secondary" disabled={saving || deleting}>{saving ? "Saving…" : "Save draft"}</ActionButton>}<ActionButton onClick={() => save(true)} variant="primary" disabled={!canPublish || saving || deleting}>{saving ? "Saving…" : event.status === "published" ? "Save changes" : "Publish event"}</ActionButton></div>
    </header>
    {saved && <div className="toast" role="status"><span><Icon name="check" /></span>Changes saved</div>}
    {saveError && <div className="toast toast-error" role="alert"><span><Icon name="x" /></span>{saveError}</div>}
    <div className="editor-layout">
      <aside className="editor-progress"><div className="progress-ring" style={{ "--progress": `${completion * 25}%` } as React.CSSProperties}><strong>{completion * 25}%</strong></div><div><strong>Event setup</strong><span>{completion === 4 ? "Ready to publish" : `${4 - completion} items remaining`}</span></div></aside>
      <section className="editor-content">
        <nav className="editor-tabs" aria-label="Event settings" role="tablist">{tabs.map((tab) => <button type="button" role="tab" id={`event-tab-${tab.toLowerCase()}`} aria-controls="event-settings-panel" aria-selected={activeTab === tab} tabIndex={activeTab === tab ? 0 : -1} key={tab} className={activeTab === tab ? "is-active" : ""} onClick={() => setActiveTab(tab)} onKeyDown={(event) => { if (event.key === "ArrowLeft") { event.preventDefault(); moveTab(tab, -1); } else if (event.key === "ArrowRight") { event.preventDefault(); moveTab(tab, 1); } else if (event.key === "Home") { event.preventDefault(); setActiveTab(tabs[0]); window.requestAnimationFrame(() => document.getElementById("event-tab-basics")?.focus()); } else if (event.key === "End") { event.preventDefault(); setActiveTab(tabs.at(-1)!); window.requestAnimationFrame(() => document.getElementById("event-tab-questions")?.focus()); } }}>{tab}</button>)}</nav>
        <div id="event-settings-panel" role="tabpanel" aria-labelledby={`event-tab-${activeTab.toLowerCase()}`}>
        {activeTab === "Basics" && <div className="editor-sections">
          <section className="form-card"><div className="form-card-title"><span className="number-chip">1</span><div><h2>Event details</h2><p>Give invitees a clear reason to book.</p></div></div><div className="form-grid">
            <Field label="Event name" required><input value={event.title} onChange={(e) => update("title", e.target.value)} placeholder="e.g. Discovery Call" /></Field>
            <Field label="Booking link" required hint={publicUrl}><div className="input-prefix"><span suppressHydrationWarning>{typeof window === "undefined" ? "/book/" : `${window.location.origin}/book/`}</span><input value={event.slug} onChange={(e) => update("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))} placeholder="discovery-call" /></div></Field>
            <Field label="Description"><textarea rows={4} value={event.description} onChange={(e) => update("description", e.target.value)} placeholder="Tell invitees what this meeting is about and how to prepare." /></Field>
            <Field label="Event color"><div className="color-options" role="radiogroup" aria-label="Event color">{["#2563eb", "#16a394", "#3978d4", "#ed7a5f", "#e2a93b", "#8f5db7"].map((color) => <button type="button" role="radio" aria-checked={event.color === color} key={color} className={event.color === color ? "is-selected" : ""} style={{ background: color, color: foregroundForBackground(color) }} onClick={() => update("color", color)} aria-label={`Use color ${color}`}><Icon name="check" size={14} /></button>)}</div></Field>
          </div></section>
          <section className="form-card"><div className="form-card-title"><span className="number-chip">2</span><div><h2>Duration options</h2><p>Invitees select one duration before viewing availability.</p></div></div><div className="duration-list" role="radiogroup" aria-label="Default duration">
            {event.durations.map((duration, index) => <div className="duration-row" key={duration.id ?? `new-${index}`}>
              <button type="button" role="radio" aria-checked={duration.isDefault} className={`radio ${duration.isDefault ? "is-selected" : ""}`} aria-label={`Make ${duration.label} the default`} onClick={() => updateDuration(index, { isDefault: true })}><span /></button>
              <div className="duration-input"><input aria-label={`Duration ${index + 1} in minutes`} type="number" min="15" max="480" value={duration.minutes} onChange={(e) => updateDuration(index, { minutes: Number(e.target.value) })} /><span>minutes</span></div>
              <select aria-label={`Payment type for ${duration.label}`} value={duration.price ? "paid" : "free"} onChange={(e) => updateDuration(index, { price: e.target.value === "paid" ? 250 : undefined, currency })}><option value="free">Free</option><option value="paid">Paid</option></select>
              {duration.price ? <div className="money-input"><span>$</span><input aria-label={`Price for ${duration.label}`} type="number" value={duration.price} onChange={(e) => updateDuration(index, { price: Number(e.target.value) })} /></div> : <span className="muted">No payment</span>}
              <button type="button" className="icon-button" onClick={() => event.durations.length > 1 && update("durations", event.durations.filter((_, i) => i !== index))} aria-label={`Remove ${duration.label}`} disabled={event.durations.length === 1}><Icon name="trash" /></button>
              {duration.isDefault && <Badge tone="brand">Default</Badge>}
            </div>)}
            <button type="button" className="add-row" onClick={addDuration}><Icon name="plus" />Add another duration</button>
          </div>{isPaid && <div className="inline-fields"><Field label="Offering currency" required><select value={currency} onChange={(e) => update("durations", event.durations.map((duration) => ({ ...duration, currency: e.target.value })))}><option>USD</option><option>CAD</option><option>GBP</option><option>EUR</option></select></Field><div className="notice notice-info"><Icon name="sparkles" /><div><strong>Payment provider is server-managed</strong><span>Publishing and checkout remain subject to verified server configuration.</span></div></div></div>}</section>
          <section className="form-card"><div className="form-card-title"><span className="number-chip">3</span><div><h2>Location</h2><p>Choose where the meeting happens and provide the details invitees need.</p></div></div><Field label="Location type" required><select value={event.locationType} onChange={(item) => { const locationType = item.target.value as EventType["locationType"]; update("locationType", locationType); update("locationValue", locationType === "GOOGLE_MEET" ? null : event.locationValue); update("location", locationType === "GOOGLE_MEET" ? "Google Meet" : event.locationValue || (locationType === "PHONE" ? "Phone call" : locationType === "IN_PERSON" ? "In person" : "Custom location")); }}><option value="GOOGLE_MEET">Google Meet</option><option value="PHONE">Phone call</option><option value="IN_PERSON">In person</option><option value="CUSTOM">Custom</option></select></Field>{event.locationType !== "GOOGLE_MEET" && <Field label={event.locationType === "PHONE" ? "Phone instructions" : event.locationType === "IN_PERSON" ? "Meeting address" : "Location details"} required hint="These details are saved with the booking and shown to invitees."><input value={event.locationValue ?? ""} onChange={(item) => { update("locationValue", item.target.value); update("location", item.target.value || (event.locationType === "PHONE" ? "Phone call" : event.locationType === "IN_PERSON" ? "In person" : "Custom location")); }} required /></Field>}</section>
        </div>}
        {activeTab === "Availability" && <div className="editor-sections"><section className="form-card"><div className="form-card-title"><span className="number-chip">1</span><div><h2>When can people book?</h2><p>Your weekly hours are combined with these event-specific rules.</p></div></div><div className="two-column"><Field label="Date range"><select value={event.bookingWindowDays} onChange={(e) => update("bookingWindowDays", Number(e.target.value))}>{![30, 60, 90].includes(event.bookingWindowDays) && <option value={event.bookingWindowDays}>{event.bookingWindowDays} days into the future</option>}<option value={30}>30 days into the future</option><option value={60}>60 days into the future</option><option value={90}>90 days into the future</option></select></Field><Field label="Minimum notice"><select value={event.minimumNoticeMinutes} onChange={(e) => update("minimumNoticeMinutes", Number(e.target.value))}>{![0, 240, 1440, 2880].includes(event.minimumNoticeMinutes) && <option value={event.minimumNoticeMinutes}>{event.minimumNoticeMinutes} minutes</option>}<option value={0}>No minimum notice</option><option value={240}>4 hours</option><option value={1440}>24 hours</option><option value={2880}>48 hours</option></select></Field><Field label="Buffer before"><select value={event.bufferBeforeMinutes} onChange={(e) => update("bufferBeforeMinutes", Number(e.target.value))}>{![0, 15, 30, 60].includes(event.bufferBeforeMinutes) && <option value={event.bufferBeforeMinutes}>{event.bufferBeforeMinutes} minutes</option>}<option value={0}>No buffer</option><option value={15}>15 minutes</option><option value={30}>30 minutes</option><option value={60}>60 minutes</option></select></Field><Field label="Buffer after"><select value={event.bufferAfterMinutes} onChange={(e) => update("bufferAfterMinutes", Number(e.target.value))}>{![0, 15, 30, 60].includes(event.bufferAfterMinutes) && <option value={event.bufferAfterMinutes}>{event.bufferAfterMinutes} minutes</option>}<option value={0}>No buffer</option><option value={15}>15 minutes</option><option value={30}>30 minutes</option><option value={60}>60 minutes</option></select></Field></div><div className="notice notice-info"><Icon name="availability" /><div><strong>Weekly hours and date overrides</strong><span>Manage your base schedule from the Availability page.</span></div></div></section></div>}
        {activeTab === "Questions" && <div className="editor-sections"><section className="form-card"><div className="form-card-title"><span className="number-chip">1</span><div><h2>Invitee questions</h2><p>Name and email are always collected. Add the context you need.</p></div></div><div className="question-list"><div className="question-row"><span className="drag-handle">⋮⋮</span><div><strong>Name</strong><span>Short answer · Required</span></div><Badge tone="neutral">System</Badge></div><div className="question-row"><span className="drag-handle">⋮⋮</span><div><strong>Email</strong><span>Email · Required</span></div><Badge tone="neutral">System</Badge></div>{event.questions.map((question, index) => <div className="question-row" key={question.id ?? `${question.label}-${index}`}><span className="drag-handle">⋮⋮</span><div><input value={question.label} onChange={(item) => update("questions", event.questions.map((current, position) => position === index ? { ...current, label: item.target.value } : current))} aria-label={`Question ${index + 1}`} /><span>{question.kind === "TEXTAREA" ? "Long answer" : "Short answer"} · {question.required ? "Required" : "Optional"}</span></div><Toggle checked={question.required} onChange={(required) => update("questions", event.questions.map((current, position) => position === index ? { ...current, required } : current))} label={`Require ${question.label}`} /><button className="icon-button" onClick={() => update("questions", event.questions.filter((_, position) => position !== index))} aria-label={`Remove ${question.label}`}><Icon name="trash" /></button></div>)}<button className="add-row" onClick={() => update("questions", [...event.questions, { label: "What should we know before meeting?", kind: "TEXTAREA", required: false, options: [] }])}><Icon name="plus" />Add a question</button></div></section></div>}
        </div>
      </section>
      <aside className="editor-preview"><span className="preview-label">Live preview</span><div className="mini-booking-card"><div className="mini-brand"><span className="mini-logo">T</span><strong>Workspace branding</strong></div><span className="mini-host">Organizer</span><h2>{event.title || "Your event title"}</h2><p>{event.description || "A clear, helpful description of what invitees can expect."}</p><div className="mini-meta"><span><Icon name="clock" />{event.durations.map((d) => d.label).join(" or ")}</span><span><Icon name="video" />{event.location}</span><span><Icon name="globe" />Invitee timezone</span></div><button type="button" disabled aria-label="Preview only">Choose a time <Icon name="arrow-right" /></button></div><small>Changes appear here as you edit.</small></aside>
    </div>
  </div>;
}
