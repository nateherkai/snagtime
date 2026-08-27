"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { BookingSlot, BookingSummary, WorkspaceBranding } from "@/lib/contracts";
import { frontendApi } from "./api-adapter";
import { clearTerminalBookingAttempt } from "./booking-attempt";
import { retainBookingRecoveryAuthority, shareBookingRecoveryLoad } from "./booking-recovery-load";
import { foregroundForBackground } from "./brand-contrast";
import { claimOneUseLinkAuthority } from "./one-use-link-authority";
import { loadRescheduleWindowSlots } from "./slot-window";
import { Icon } from "./icons";
import { ActionButton, Field } from "./ui";

function bookingDate(booking: BookingSummary) {
  return new Intl.DateTimeFormat("en-US", { timeZone: booking.inviteeTimeZone, weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(new Date(booking.startAt));
}
function bookingTime(booking: BookingSummary) {
  return new Intl.DateTimeFormat("en-US", { timeZone: booking.inviteeTimeZone, hour: "numeric", minute: "2-digit" }).format(new Date(booking.startAt));
}
function calendarDelivery(booking: BookingSummary) {
  switch (booking.notificationStatus) {
    case "GOOGLE_UPDATE_ACCEPTED": return "Google Calendar has received the latest booking update.";
    case "LOCAL_NO_EMAIL": return "This booking is saved in the local calendar.";
    case "RETRY_PENDING": return "Calendar sync will retry automatically.";
    case "PENDING": return "Calendar sync is in progress.";
  }
}
function bookingLocation(booking: BookingSummary) {
  if (booking.locationType === "GOOGLE_MEET") return booking.calendarProvider === "google" && booking.calendarSyncStatus === "SYNCED" ? "Google Meet" : "Online meeting details unavailable";
  if (booking.locationType === "PHONE") return booking.locationValue || "Phone call";
  if (booking.locationType === "IN_PERSON") return booking.locationValue || "In person";
  return booking.locationValue || "Custom location";
}
function dateKey(value: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function usePublicBranding(slug: string) {
  const [branding, setBranding] = useState<WorkspaceBranding | null>(null);
  useEffect(() => { if (!slug) return; let active = true; frontendApi.getPublicEvent(slug).then((event) => { if (active) setBranding(event.branding ?? null); }).catch(() => undefined); return () => { active = false; }; }, [slug]);
  return branding;
}

export function ConfirmationView({ slug, bookingId, payment, readCapability, cancelCapability, rescheduleCapability }: { slug: string; bookingId?: string; payment?: string; readCapability?: string; cancelCapability?: string; rescheduleCapability?: string }) {
  const incomplete = !bookingId;
  const branding = usePublicBranding(slug);
  const [booking, setBooking] = useState<BookingSummary | null>(null);
  const [loading, setLoading] = useState(!incomplete);
  const [error, setError] = useState(incomplete ? "This confirmation link is incomplete." : "");
  const started = useRef(false);
  const verify = useCallback(async () => {
    if (!bookingId) return;
    setLoading(true);
    setError("");
    const legacyPresent = Boolean(readCapability || cancelCapability || rescheduleCapability);
    const cleanUrl = `/book/${encodeURIComponent(slug)}/confirmation?booking=${encodeURIComponent(bookingId)}${payment ? `&payment=${encodeURIComponent(payment)}` : ""}`;
    let exchangeFailed = false;
    try {
      if (legacyPresent) {
        if (readCapability && cancelCapability && rescheduleCapability) {
          try {
            await frontendApi.exchangeBookingManageSession(bookingId, { read: readCapability, cancel: cancelCapability, reschedule: rescheduleCapability, expiresAt: "" });
          } catch {
            exchangeFailed = true;
          }
        } else {
          exchangeFailed = true;
        }
      }

      const verified = await frontendApi.getBookingForManage(bookingId);
      await frontendApi.acknowledgeBookingManageSession(bookingId);
      window.history.replaceState(null, "", cleanUrl);
      setBooking(verified);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Could not verify this booking.";
      setError(exchangeFailed ? `Secure session recovery did not complete. ${message}` : message);
    } finally {
      setLoading(false);
    }
  }, [bookingId, cancelCapability, payment, readCapability, rescheduleCapability, slug]);
  useEffect(() => {
    if (!bookingId || started.current) return;
    started.current = true;
    void verify();
  }, [bookingId, verify]);
  const calendarPending = booking?.calendarSyncStatus === "PENDING" || booking?.notificationStatus === "PENDING" || booking?.notificationStatus === "RETRY_PENDING";
  useEffect(() => {
    if (!bookingId || !calendarPending) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    const refresh = async () => {
      attempts += 1;
      try {
        const refreshed = await frontendApi.getBookingForManage(bookingId);
        if (!active) return;
        setBooking(refreshed);
        const stillPending = refreshed.calendarSyncStatus === "PENDING" || refreshed.notificationStatus === "PENDING" || refreshed.notificationStatus === "RETRY_PENDING";
        if (stillPending && attempts < 5) timer = setTimeout(() => void refresh(), attempts * 800);
      } catch {
        if (active && attempts < 5) timer = setTimeout(() => void refresh(), attempts * 800);
      }
    };
    timer = setTimeout(() => void refresh(), 600);
    return () => { active = false; if (timer) clearTimeout(timer); };
  }, [bookingId, calendarPending]);
  useEffect(() => { if (booking && booking.status !== "PENDING_PAYMENT") clearTerminalBookingAttempt(slug); }, [booking, slug]);
  if (loading) return <ManageLoading label="Verifying your booking…" />;
  if (!booking) return incomplete ? <ManageError title="Booking not verified" description={error} branding={branding} /> : <ManageRetry bookingId={bookingId} description={error} onRetry={verify} branding={branding} />;
  if (booking.status === "PENDING_PAYMENT") return <PaymentPending booking={booking} branding={branding} payment={payment} slug={slug} />;
  if (booking.status === "CANCELLED") return <ManageError title="This booking is canceled" description="The booking is no longer active." />;
  const slugQuery = `slug=${encodeURIComponent(slug)}`;
  return <div className="public-page outcome-page"><BrandHeader branding={branding} /><main className="outcome-shell"><div className="success-mark" style={{ color: branding?.accentColor }}><Icon name="check" size={34} /></div><span className="outcome-eyebrow">Booking confirmed</span><h1>You’re booked, {booking.inviteeName}.</h1><p>Your meeting details are ready. Keep this page handy if you need to make a change.</p><BookingCard booking={booking} branding={branding} /><div className="manage-row"><span>Need to make a change?</span><Link href={`/manage/${booking.id}/reschedule?${slugQuery}`}>Reschedule</Link><i>·</i><Link href={`/manage/${booking.id}/cancel?${slugQuery}`}>Cancel</Link></div><small className="reference">Booking reference · {booking.id}</small></main><PublicFooter branding={branding} /></div>;
}

export function CancelBookingView({ bookingId, slug = "" }: { bookingId: string; slug?: string }) {
  const router = useRouter();
  const branding = usePublicBranding(slug);
  const [booking, setBooking] = useState<BookingSummary | null>(null);
  const [reason, setReason] = useState("");
  const [canceled, setCanceled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [loadingBooking, setLoadingBooking] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    frontendApi.getBookingForManage(bookingId).then(setBooking).catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load this booking.")).finally(() => setLoadingBooking(false));
  }, [bookingId]);
  const cancel = async () => {
    setLoading(true); setError("");
    try { const updated = await frontendApi.cancelBooking(bookingId, reason || undefined); setBooking(updated); setCanceled(true); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not cancel this booking."); }
    finally { setLoading(false); }
  };
  const resumeCheckout = async () => {
    setRecovering(true); setError("");
    try {
      const result = await frontendApi.resumeBookingCheckout(bookingId);
      if (result.bookingId !== bookingId) throw new Error("The recovered payment attempt does not match this booking.");
      if (result.checkoutUrl) { window.location.assign(result.checkoutUrl); return; }
      if (result.status !== "PENDING_PAYMENT") { router.push(`/book/${encodeURIComponent(slug)}/confirmation?booking=${encodeURIComponent(bookingId)}`); return; }
      setError("Hosted checkout is not currently available. This booking remains pending payment.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not recover hosted checkout."); }
    finally { setRecovering(false); }
  };
  if (loadingBooking) return <ManageLoading label="Loading booking…" branding={branding} />;
  if (!booking) return <ManageFrame title="Booking unavailable" description="A secure booking session could not be verified." branding={branding}>{error && <div className="form-error" role="alert">{error}</div>}<BookingRecoveryForm bookingId={bookingId} onAccepted={() => setError("")} /></ManageFrame>;
  if (canceled || booking.status === "CANCELLED") return <ManageOutcome title="Your booking is canceled" description={booking.refundStatus === "REFUND_PENDING" ? "The time has been released. Your provider refund is queued for processing." : booking.refundStatus === "REFUNDED" ? `The time has been released and ${(booking.refundedAmountCents / 100).toFixed(2)} ${booking.currency.toUpperCase()} was refunded.` : booking.refundStatus === "REFUND_FAILED" ? "The time has been released, but the refund needs organizer attention." : "The time has been released and is available to book again."} branding={branding} />;
  return <ManageFrame title="Cancel this booking" description="Review your meeting details before canceling." branding={branding}><BookingManageSummary booking={booking} branding={branding} /><div className="manage-form">{booking.status === "PENDING_PAYMENT" && booking.priceCents > 0 && <div className="notice notice-info"><Icon name="sparkles" /><div><strong>Checkout was interrupted</strong><span>Your time is still on hold. Resume checkout or cancel the booking below.</span></div></div>}{booking.status === "PENDING_PAYMENT" && booking.priceCents > 0 && <ActionButton variant="primary" onClick={resumeCheckout} disabled={recovering}>{recovering ? "Opening checkout…" : "Resume checkout"}</ActionButton>}<Field label="Reason for canceling (optional)"><select value={reason} onChange={(item) => setReason(item.target.value)}><option value="">Choose a reason</option><option>Schedule conflict</option><option>No longer needed</option><option>Booked by mistake</option><option>Other</option></select></Field>{booking.priceCents > 0 && booking.status !== "PENDING_PAYMENT" && <div className="notice notice-warning"><Icon name="sparkles" /><div><strong>Refund processing</strong><span>Canceling queues an eligible refund with the configured payment provider. Processing is not immediate.</span></div></div>}{error && <div className="form-error" role="alert">{error}</div>}<ActionButton variant="danger" onClick={cancel} disabled={loading}>{loading ? "Canceling…" : "Cancel booking"}</ActionButton></div></ManageFrame>;
}

export function RescheduleBookingView({ bookingId, slug = "" }: { bookingId: string; slug?: string }) {
  const branding = usePublicBranding(slug);
  const [booking, setBooking] = useState<BookingSummary | null>(null);
  const [slots, setSlots] = useState<BookingSlot[]>([]);
  const [selectedStart, setSelectedStart] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingBooking, setLoadingBooking] = useState(true);
  const [done, setDone] = useState(false);
  const [refreshedAfterSuccess, setRefreshedAfterSuccess] = useState(false);
  const [dayOffset, setDayOffset] = useState(0);
  const [selectedDate, setSelectedDate] = useState("");
  const [error, setError] = useState("");
  const recoveryAuthority = useRef("");
  useEffect(() => {
    let active = true;
    const load = () => {
      const recovery = retainBookingRecoveryAuthority(recoveryAuthority, () => claimOneUseLinkAuthority("recovery"));
      if (recovery) { setBooking(null); setLoadingBooking(true); setError(""); }
      const key = `${bookingId}\u0000${slug}\u0000${recovery ?? ""}`;
      const recoveryLoad = shareBookingRecoveryLoad(key, async () => {
        if (recovery) {
          let consumeFailure: unknown;
          try {
            const established = await frontendApi.consumeBookingManageLink(recovery);
            if (established.bookingId !== bookingId) throw new Error("This recovery link does not match the requested booking.");
          } catch (reason) {
            consumeFailure = reason;
          }
          try {
            await frontendApi.getBookingForManage(bookingId);
          } catch {
            throw consumeFailure ?? new Error("Could not establish a secure booking session.");
          }
        }
        const item = await frontendApi.getBookingForManage(bookingId);
        await frontendApi.acknowledgeBookingManageSession(bookingId);
        const items = await loadRescheduleWindowSlots(item.id, item.bookingWindowDays, item.inviteeTimeZone, item.durationId ?? undefined);
        const nextSlots = items.filter((slot) => new Date(slot.start).getTime() !== new Date(item.startAt).getTime());
        return { item, nextSlots };
      });
      void recoveryLoad.promise.then(({ item, nextSlots }) => {
        if (!active) return;
        setBooking(item);
        setSlots(nextSlots);
        setSelectedDate(nextSlots[0] ? dateKey(nextSlots[0].start, item.inviteeTimeZone) : "");
        setDayOffset(0);
        setError("");
      }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Could not load reschedule options."); }).finally(() => { if (active) { recoveryAuthority.current = ""; setLoadingBooking(false); } });
    };
    load();
    window.addEventListener("hashchange", load);
    return () => { active = false; window.removeEventListener("hashchange", load); };
  }, [bookingId, slug]);
  const days = useMemo(() => {
    if (!booking) return [];
    return [...new Set(slots.map((slot) => dateKey(slot.start, booking.inviteeTimeZone)))];
  }, [booking, slots]);
  const activeDate = selectedDate || days[0] || "";
  const visibleDays = days.slice(dayOffset, dayOffset + 7);
  const available = booking ? slots.filter((slot) => dateKey(slot.start, booking.inviteeTimeZone) === activeDate && new Date(slot.start).getTime() !== new Date(booking.startAt).getTime()) : [];
  const reschedule = async () => {
    if (!selectedStart) { setError("Choose a new time."); return; }
    if (booking && new Date(selectedStart).getTime() === new Date(booking.startAt).getTime()) { setError("Choose a time different from the current booking."); return; }
    setLoading(true); setError("");
    try {
      const preferredDate = activeDate;
      const updated = await frontendApi.rescheduleBooking(bookingId, selectedStart);
      setBooking(updated); setDone(true); setRefreshedAfterSuccess(false); setSelectedStart("");
      try {
        const refreshed = await frontendApi.getBookingForManage(bookingId);
        const nextSlots = await loadRescheduleWindowSlots(refreshed.id, refreshed.bookingWindowDays, refreshed.inviteeTimeZone, refreshed.durationId ?? undefined);
        const filteredSlots = nextSlots.filter((slot) => new Date(slot.start).getTime() !== new Date(refreshed.startAt).getTime());
        const nextDays = [...new Set(filteredSlots.map((slot) => dateKey(slot.start, refreshed.inviteeTimeZone)))];
        const nextDate = nextDays.includes(preferredDate) ? preferredDate : nextDays[0] ?? "";
        setBooking(refreshed);
        setSlots(filteredSlots);
        setSelectedDate(nextDate);
        const nextIndex = nextDays.indexOf(nextDate);
        setDayOffset(nextIndex >= 0 ? Math.floor(nextIndex / 7) * 7 : 0);
        setRefreshedAfterSuccess(true);
      } catch { setError("The booking was rescheduled, but fresh availability could not be loaded. Reload before making another change."); }
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not reschedule this booking."); }
    finally { setLoading(false); }
  };
  if (loadingBooking) return <ManageLoading label="Loading available times…" branding={branding} />;
  if (!booking) return <ManageFrame title="Booking unavailable" description="A secure booking session could not be verified." branding={branding}>{error && <div className="form-error" role="alert">{error}</div>}<BookingRecoveryForm bookingId={bookingId} onAccepted={() => setError("")} /></ManageFrame>;
  if (done) return <ManageFrame title="Your meeting is rescheduled" description={`Your new time is ${bookingDate(booking)} at ${bookingTime(booking)} (${booking.inviteeTimeZone}).`} branding={branding}><BookingManageSummary booking={booking} branding={branding} />{error && <div className="form-error" role="alert">{error}</div>}{refreshedAfterSuccess && <ActionButton variant="secondary" onClick={() => { setDone(false); setRefreshedAfterSuccess(false); setError(""); }}>Choose another time</ActionButton>}</ManageFrame>;
  return <ManageFrame title="Choose a new time" description="Your current time stays reserved until you confirm a replacement." branding={branding}><BookingManageSummary booking={booking} branding={branding} />{error && <div className="form-error" role="alert">{error}</div>}<div className="reschedule-picker"><div className="calendar-heading"><span>Available dates</span><div><button type="button" className="icon-button" aria-label="Previous available dates" disabled={dayOffset === 0} onClick={() => { const next = Math.max(0, dayOffset - 7); setDayOffset(next); setSelectedDate(days[next] ?? ""); setSelectedStart(""); }}><Icon name="arrow-left" /></button><button type="button" className="icon-button" aria-label="Next available dates" disabled={dayOffset + 7 >= days.length} onClick={() => { const next = Math.min(dayOffset + 7, Math.max(0, days.length - 1)); setDayOffset(next); setSelectedDate(days[next] ?? ""); setSelectedStart(""); }}><Icon name="arrow-right" /></button></div></div><div className="calendar-week">{visibleDays.map((key) => { const date = new Date(`${key}T12:00:00Z`); return <button type="button" className={activeDate === key ? "is-selected" : ""} aria-pressed={activeDate === key} onClick={() => { setSelectedDate(key); setSelectedStart(""); }} key={key}><span>{new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: booking.inviteeTimeZone }).format(date)}</span><strong>{new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone: booking.inviteeTimeZone }).format(date)}</strong></button>; })}</div><div className="time-grid">{available.map((slot) => <button type="button" className={selectedStart === slot.start ? "is-selected" : ""} aria-pressed={selectedStart === slot.start} onClick={() => setSelectedStart(slot.start)} key={slot.start}>{new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: booking.inviteeTimeZone }).format(new Date(slot.start))}{selectedStart === slot.start && <Icon name="check" size={15} />}</button>)}</div>{slots.length === 0 && <div className="empty-state"><p>No reschedule times are currently available.</p></div>}<ActionButton variant="primary" className="flow-next" disabled={loading || !selectedStart} onClick={reschedule}>{loading ? "Rescheduling…" : "Confirm new time"} <Icon name="arrow-right" /></ActionButton></div></ManageFrame>;
}

function BookingCard({ booking, branding }: { booking: BookingSummary; branding: WorkspaceBranding | null }) {
  return <section className="confirmation-card"><div className="confirmation-brand"><BrandLogo branding={branding} /><div><strong>{booking.eventTitleSnapshot}</strong><span>{branding?.workspaceName || "SnagTime booking"}</span></div></div><dl><div><dt><Icon name="calendar" />Date and time</dt><dd>{bookingDate(booking)} at {bookingTime(booking)}<small>{booking.durationMinutes} minutes · {booking.inviteeTimeZone}</small></dd></div><div><dt><Icon name="video" />Location</dt><dd>{bookingLocation(booking)}<small>Your meeting location</small></dd></div><div><dt><Icon name="video" />Calendar</dt><dd>{booking.calendarSyncStatus.toLowerCase()}<small>{calendarDelivery(booking)}</small></dd></div>{booking.priceCents > 0 && <div><dt><Icon name="sparkles" />Payment</dt><dd>${(booking.priceCents / 100).toFixed(2)} {booking.currency.toUpperCase()}<small>{booking.status === "CONFIRMED" ? "Confirmed" : booking.status.replaceAll("_", " ").toLowerCase()}</small></dd></div>}</dl></section>;
}
function PaymentPending({ booking, branding, payment, slug }: { booking: BookingSummary; branding: WorkspaceBranding | null; payment?: string; slug: string }) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const resume = async () => {
    setWorking(true); setError("");
    try {
      const result = await frontendApi.resumeBookingCheckout(booking.id);
      if (result.bookingId !== booking.id) throw new Error("The recovered payment attempt does not match this booking.");
      if (result.checkoutUrl) { window.location.assign(result.checkoutUrl); return; }
      if (result.status !== "PENDING_PAYMENT") { window.location.reload(); return; }
      setError("Hosted checkout is not currently available. Your pending booking was not presented as confirmed.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not recover hosted checkout."); }
    finally { setWorking(false); }
  };
  const slugQuery = `slug=${encodeURIComponent(slug)}`;
  return <div className="public-page outcome-page"><BrandHeader branding={branding} /><main className="outcome-shell"><span className="outcome-eyebrow">Payment pending</span><h1>{payment === "success" ? "We’re confirming your payment" : "Your booking is not confirmed yet"}</h1><p>{payment === "success" ? "Checkout is complete. Refresh in a moment while we confirm the payment." : "Checkout was canceled or interrupted. You can pick up where you left off."}</p><BookingCard booking={booking} branding={branding} />{error && <div className="form-error" role="alert">{error}</div>}<div className="manage-row">{payment === "success" ? <ActionButton variant="primary" onClick={() => window.location.reload()}>Refresh payment status</ActionButton> : <ActionButton variant="primary" onClick={resume} disabled={working}>{working ? "Opening checkout…" : "Resume checkout"}</ActionButton>}<Link href={`/manage/${booking.id}/cancel?${slugQuery}`}>Cancel booking</Link></div><small className="reference">Booking reference · {booking.id}</small></main><PublicFooter branding={branding} /></div>;
}
function BookingManageSummary({ booking, branding }: { booking: BookingSummary; branding: WorkspaceBranding | null }) { return <div className="manage-summary"><BrandLogo branding={branding} /><div><strong>{booking.eventTitleSnapshot}</strong><span>{booking.inviteeName} · {booking.inviteeEmail}</span><small><Icon name="calendar" />{bookingDate(booking)} · {bookingTime(booking)}</small><small><Icon name="clock" />{booking.durationMinutes} minutes · {booking.inviteeTimeZone}</small><small><Icon name="video" />{bookingLocation(booking)}</small></div></div>; }
function ManageFrame({ title, description, branding, children }: { title: string; description: string; branding: WorkspaceBranding | null; children: ReactNode }) { return <div className="public-page manage-page"><BrandHeader branding={branding} /><main className="manage-shell"><span className="outcome-eyebrow">Manage booking</span><h1>{title}</h1><p>{description}</p>{children}</main><PublicFooter branding={branding} /></div>; }
function ManageLoading({ label, branding = null }: { label: string; branding?: WorkspaceBranding | null }) { return <div className="public-page manage-page"><BrandHeader branding={branding} /><main className="manage-shell" role="status"><span className="spinner" /><p>{label}</p></main><PublicFooter branding={branding} /></div>; }
function ManageRetry({ bookingId, description, onRetry, branding = null }: { bookingId: string; description: string; onRetry: () => Promise<void>; branding?: WorkspaceBranding | null }) { return <div className="public-page manage-page"><BrandHeader branding={branding} /><main className="manage-shell"><span className="outcome-eyebrow">Secure recovery paused</span><h1>Booking not verified</h1><p role="alert">{description}</p><p>Retry the existing secure session or request a new manage link.</p><div className="auth-actions"><ActionButton variant="primary" onClick={() => void onRetry()}>Retry secure verification</ActionButton></div><BookingRecoveryForm bookingId={bookingId} /></main><PublicFooter branding={branding} /></div>; }
function BookingRecoveryForm({ bookingId, onAccepted }: { bookingId: string; onAccepted?: () => void }) { const [email, setEmail] = useState(""); const [working, setWorking] = useState(false); const [accepted, setAccepted] = useState(false); const [error, setError] = useState(""); const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setWorking(true); setError(""); try { await frontendApi.requestBookingManageLink(bookingId, email.trim()); setAccepted(true); onAccepted?.(); } catch (reason) { setError(reason instanceof Error ? reason.message : "The request could not be accepted."); } finally { setWorking(false); } }; if (accepted) return <div className="notice notice-info" role="status"><Icon name="check" /><div><strong>Request accepted</strong><span>If the booking and email match an eligible record, manage instructions will be made available through the configured email provider. Delivery is not claimed here.</span></div></div>; return <form className="manage-recovery-form" onSubmit={submit}><Field label="Booking email" required hint="The response does not confirm whether this booking and email match."><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></Field>{error && <div className="form-error" role="alert">{error}</div>}<ActionButton variant="secondary" type="submit" disabled={working || !email.includes("@")} >{working ? "Submitting…" : "Request a new manage link"}</ActionButton></form>; }
function ManageError({ title, description, branding = null }: { title: string; description: string; branding?: WorkspaceBranding | null }) { return <div className="public-page manage-page"><BrandHeader branding={branding} /><main className="manage-shell"><span className="outcome-eyebrow">Unable to continue</span><h1>{title}</h1><p role="alert">{description}</p></main><PublicFooter branding={branding} /></div>; }
function ManageOutcome({ title, description, branding = null }: { title: string; description: string; branding?: WorkspaceBranding | null }) { return <div className="public-page outcome-page"><BrandHeader branding={branding} /><main className="outcome-shell"><div className="success-mark" style={{ color: branding?.accentColor }}><Icon name="check" size={34} /></div><span className="outcome-eyebrow">Verified</span><h1>{title}</h1><p>{description}</p></main><PublicFooter branding={branding} /></div>; }
function BrandLogo({ branding }: { branding: WorkspaceBranding | null }) { const initial = branding?.workspaceName.charAt(0).toUpperCase() || "T"; return <span className="public-logo" style={{ background: branding?.accentColor, color: foregroundForBackground(branding?.accentColor) }}>{branding?.logoUrl ? <span role="img" aria-label={`${branding.workspaceName} logo`} style={{ display: "block", width: "100%", height: "100%", borderRadius: "inherit", background: `#fff center / contain no-repeat url(${JSON.stringify(branding.logoUrl)})` }} /> : initial}</span>; }
function BrandHeader({ branding }: { branding: WorkspaceBranding | null }) { return <header className="public-header"><div className="booking-brand"><BrandLogo branding={branding} /><div><strong>{branding?.workspaceName || "SnagTime"}</strong><span>{branding?.description || "Secure scheduling"}</span></div></div></header>; }
function PublicFooter({ branding }: { branding: WorkspaceBranding | null }) { return <footer className="public-footer"><span>{branding?.footerText || "Powered by SnagTime"}</span><span>Secure booking management</span></footer>; }
