"use client";

import { snagTimeApi } from "@/lib/api-client";
import type { AvailabilityOverride, AvailabilitySchedule, BookingSlot, BookingSummary, CreateEventTypeInput, EventTypeSummary } from "@/lib/contracts";
import type { AvailabilityDay, Booking, EventType } from "./demo-data";

export function mapEventType(item: EventTypeSummary): EventType {
  const location = item.locationType === "GOOGLE_MEET" ? "Google Meet" : item.locationType === "PHONE" ? item.locationValue || "Phone call" : item.locationType === "IN_PERSON" ? item.locationValue || "In person" : item.locationValue ?? "Custom location";
  return {
    id: item.id,
    title: item.name,
    slug: item.slug,
    description: item.description ?? "",
    color: item.color,
    status: item.isActive ? "published" : "draft",
    location,
    locationType: item.locationType,
    locationValue: item.locationValue,
    durations: (item.durations.length ? item.durations : [{ id: "default", label: `${item.durationMinutes} min`, durationMinutes: item.durationMinutes, isDefault: true, priceCents: item.priceCents, currency: item.currency, position: 0 }]).map((duration) => ({ id: duration.id, minutes: duration.durationMinutes, label: duration.label, isDefault: duration.isDefault, price: duration.priceCents > 0 ? duration.priceCents / 100 : undefined, currency: duration.currency })),
    questions: item.questions.map((question) => ({ id: question.id, label: question.label, kind: question.kind, required: question.required, options: question.options })),
    bookingWindowDays: item.bookingWindowDays,
    bufferBeforeMinutes: item.bufferBeforeMinutes,
    bufferAfterMinutes: item.bufferAfterMinutes,
    minimumNoticeMinutes: item.minimumNoticeMinutes,
    bookingCount: item.bookingCount,
    hostName: item.hostName,
    branding: item.branding,
  };
}

export function toEventInput(event: EventType): CreateEventTypeInput {
  const primary = event.durations.find((item) => item.isDefault) ?? event.durations[0] ?? { minutes: 30, label: "30 min", isDefault: true };
  const locationType = event.locationType;
  return {
    name: event.title,
    slug: event.slug,
    description: event.description || null,
    durationMinutes: primary.minutes,
    color: event.color,
    locationType,
    locationValue: locationType === "GOOGLE_MEET" ? null : event.locationValue,
    isActive: event.status === "published",
    bufferBeforeMinutes: event.bufferBeforeMinutes,
    bufferAfterMinutes: event.bufferAfterMinutes,
    minimumNoticeMinutes: event.minimumNoticeMinutes,
    bookingWindowDays: event.bookingWindowDays,
    priceCents: primary.price ? Math.round(primary.price * 100) : 0,
    currency: primary.currency ?? "USD",
    durations: event.durations.map((duration, position) => ({ ...(duration.id ? { id: duration.id } : {}), label: duration.label, durationMinutes: duration.minutes, isDefault: duration.isDefault, priceCents: duration.price ? Math.round(duration.price * 100) : 0, currency: duration.currency ?? "USD", position })),
    questions: event.questions.map((question, position) => ({ ...(question.id ? { id: question.id } : {}), label: question.label, kind: question.kind, required: question.required, options: question.options, position })),
  };
}

function minutesToTime(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const suffix = hours >= 12 ? "PM" : "AM";
  const display = hours % 12 || 12;
  return `${display}:${mins.toString().padStart(2, "0")} ${suffix}`;
}

function timeToMinutes(value: string) {
  const match = value.match(/(\d+):(\d+)\s(AM|PM)/);
  if (!match) return 540;
  let hour = Number(match[1]) % 12;
  if (match[3] === "PM") hour += 12;
  return hour * 60 + Number(match[2]);
}

export function mapAvailability(schedule: AvailabilitySchedule): AvailabilityDay[] {
  const names: ReadonlyArray<readonly [string, string]> = [["Sunday", "Sun"], ["Monday", "Mon"], ["Tuesday", "Tue"], ["Wednesday", "Wed"], ["Thursday", "Thu"], ["Friday", "Fri"], ["Saturday", "Sat"]];
  return names.slice(1).concat(names.slice(0, 1)).map(([day, short], index) => {
    const apiDay = index === 6 ? 0 : index + 1;
    const windows = schedule.intervals.filter((interval) => interval.dayOfWeek === apiDay).map((interval) => ({ id: interval.id ?? `${apiDay}-${interval.startMinute}`, start: minutesToTime(interval.startMinute), end: minutesToTime(interval.endMinute) }));
    return { day, short, enabled: windows.length > 0, windows };
  });
}

export function toAvailability(days: AvailabilityDay[], timeZone = "America/Chicago"): AvailabilitySchedule {
  return { timeZone, intervals: days.flatMap((day, index) => day.enabled ? day.windows.map((window) => ({ dayOfWeek: index === 6 ? 0 : index + 1, startMinute: timeToMinutes(window.start), endMinute: timeToMinutes(window.end) })) : []) };
}

export function mapBooking(item: BookingSummary, organizerTimeZone = item.inviteeTimeZone): Booking {
  const start = new Date(item.startAt);
  const end = new Date(item.endAt);
  const location = item.locationType === "GOOGLE_MEET"
    ? item.calendarProvider === "google" && item.calendarSyncStatus === "SYNCED" ? "Google Meet" : "Online meeting details unavailable"
    : item.locationType === "PHONE" ? item.locationValue || "Phone call"
      : item.locationType === "IN_PERSON" ? item.locationValue || "In person"
        : item.locationValue || "Custom location";
  return {
    id: item.id,
    eventTypeId: item.eventTypeId,
    invitee: item.inviteeName,
    email: item.inviteeEmail,
    eventTitle: item.eventTitleSnapshot,
    startsAt: item.startAt,
    dateLabel: start.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: organizerTimeZone }),
    timeLabel: `${start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: organizerTimeZone })} – ${end.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: organizerTimeZone })}`,
    duration: Math.round((end.getTime() - start.getTime()) / 60000),
    timezone: item.inviteeTimeZone,
    organizerTimeZone,
    status: item.status === "PENDING_PAYMENT" ? "pending" : item.status === "CANCELLED" ? "canceled" : "confirmed",
    hostName: item.hostName,
    notificationStatus: item.notificationStatus,
    location,
    answers: item.answers,
    cancellationReason: item.cancellationReason ?? undefined,
    notes: item.notes ?? undefined,
  };
}

export const frontendApi = {
  session: snagTimeApi.session,
  login: snagTimeApi.login,
  logout: snagTimeApi.logout,
  signup: snagTimeApi.signup,
  requestPasswordReset: snagTimeApi.requestPasswordReset,
  resetPassword: snagTimeApi.resetPassword,
  requestEmailVerification: snagTimeApi.requestEmailVerification,
  verifyEmail: snagTimeApi.verifyEmail,
  getAccount: snagTimeApi.getAccount,
  updateProfileImage: snagTimeApi.updateProfileImage,
  changePassword: snagTimeApi.changePassword,
  completeOnboarding: snagTimeApi.completeOnboarding,
  switchWorkspace: snagTimeApi.switchWorkspace,
  listWorkspaceMembers: snagTimeApi.listWorkspaceMembers,
  updateWorkspaceMember: snagTimeApi.updateWorkspaceMember,
  listWorkspaceInvitations: snagTimeApi.listWorkspaceInvitations,
  createWorkspaceInvitation: snagTimeApi.createWorkspaceInvitation,
  acceptWorkspaceInvitation: snagTimeApi.acceptWorkspaceInvitation,
  async listEventTypes() {
    return (await snagTimeApi.listEventTypes()).map(mapEventType);
  },
  async getEventType(id: string) {
    return mapEventType(await snagTimeApi.getEventType(id));
  },
  async saveEventType(event: EventType, mode: "edit" | "create", publish: boolean) {
    const input = toEventInput({ ...event, status: publish ? "published" : event.status });
    const saved = mode === "create" ? await snagTimeApi.createEventType(input) : await snagTimeApi.updateEventType(event.id, input);
    return mapEventType(saved);
  },
  async deleteEventType(id: string) { return snagTimeApi.deleteEventType(id); },
  async getAvailability() { const schedule = await snagTimeApi.getAvailability(); return { days: mapAvailability(schedule), timeZone: schedule.timeZone, overrides: schedule.overrides ?? [] }; },
  async saveAvailability(days: AvailabilityDay[], timeZone: string, overrides: AvailabilityOverride[]) { const schedule = await snagTimeApi.setAvailability({ ...toAvailability(days, timeZone), overrides }); return { days: mapAvailability(schedule), timeZone: schedule.timeZone, overrides: schedule.overrides ?? [] }; },
  async listBookings(organizerTimeZone?: string) { return (await snagTimeApi.listBookings()).map((item) => mapBooking(item, organizerTimeZone)); },
  async getPublicEvent(slug: string) { return mapEventType(await snagTimeApi.getPublicEventType(slug)); },
  async getSlots(slug: string, from: string, to: string, timeZone: string, durationId?: string, signal?: AbortSignal): Promise<BookingSlot[]> { return snagTimeApi.getSlots(slug, from, to, timeZone, durationId, signal); },
  createBooking: snagTimeApi.createBooking,
  resumeBookingCheckout: snagTimeApi.resumeBookingCheckout,
  exchangeBookingManageSession: snagTimeApi.exchangeBookingManageSession,
  acknowledgeBookingManageSession: snagTimeApi.acknowledgeBookingManageSession,
  getBookingForManage: snagTimeApi.getBookingForManage,
  getRescheduleSlots: snagTimeApi.getRescheduleSlots,
  rescheduleBooking: snagTimeApi.rescheduleBooking,
  cancelBooking: snagTimeApi.cancelBooking,
  requestBookingManageLink: snagTimeApi.requestBookingManageLink,
  consumeBookingManageLink: snagTimeApi.consumeBookingManageLink,
  getWorkspaceBranding: snagTimeApi.getWorkspaceBranding,
  updateWorkspaceBranding: snagTimeApi.updateWorkspaceBranding,
  getIntegrationStatus: snagTimeApi.getIntegrationStatus,
  getGoogleStatus: snagTimeApi.getGoogleStatus,
  disconnectGoogle: snagTimeApi.disconnectGoogle,
  googleAuthorizePath: snagTimeApi.googleAuthorizePath,
  listLocalEmailInbox: snagTimeApi.listLocalEmailInbox,
  retryEmailOutbox: snagTimeApi.retryEmailOutbox,
};
