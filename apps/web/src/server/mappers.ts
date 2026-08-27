import type { Booking, BookingAnswer as StoredAnswer, CustomQuestion as StoredQuestion, EventDuration, EventType, User } from "@prisma/client";
import type { BookingSummary, EventTypeSummary, SessionUser } from "@/lib/contracts";

export function mapUser(user: User): SessionUser {
  return { id: user.id, email: user.email, name: user.name, imageUrl: user.imageUrl, timeZone: user.timeZone };
}

type EventWithOptions = EventType & { durations?: EventDuration[]; questions?: StoredQuestion[]; owner?: { name?: string }; workspace?: { branding: { workspaceName: string; logoUrl: string | null; accentColor: string; description: string | null; footerText: string | null } | null }; _count?: { bookings: number } };
export function mapEventType(eventType: EventWithOptions): EventTypeSummary {
  const durations = eventType.durations?.map((item) => ({
    id: item.id, label: item.label, durationMinutes: item.durationMinutes, isDefault: item.isDefault,
    priceCents: item.priceCents, currency: item.currency, position: item.position,
  })) ?? [{ id: "legacy-default", label: `${eventType.durationMinutes} min`, durationMinutes: eventType.durationMinutes, isDefault: true, priceCents: eventType.priceCents, currency: eventType.currency, position: 0 }];
  return {
    id: eventType.id, name: eventType.name, slug: eventType.slug, description: eventType.description,
    durationMinutes: eventType.durationMinutes, color: eventType.color,
    locationType: eventType.locationType as EventTypeSummary["locationType"], locationValue: eventType.locationValue,
    isActive: eventType.isActive, bufferBeforeMinutes: eventType.bufferBeforeMinutes,
    bufferAfterMinutes: eventType.bufferAfterMinutes, minimumNoticeMinutes: eventType.minimumNoticeMinutes,
    bookingWindowDays: eventType.bookingWindowDays, priceCents: eventType.priceCents, currency: eventType.currency,
    bookingUrl: `/book/${eventType.slug}`,
    durations,
    questions: eventType.questions?.map((item) => ({
      id: item.id, label: item.label, kind: item.kind as EventTypeSummary["questions"][number]["kind"],
      required: item.required, options: item.optionsJson ? JSON.parse(item.optionsJson) as string[] : [], position: item.position,
    })) ?? [],
    branding: eventType.workspace?.branding ?? null,
    bookingCount: eventType._count?.bookings ?? 0, hostName: eventType.owner?.name ?? "Host",
  };
}

type BookingWithSummary = Booking & { eventType: { name: string }; host?: { name: string }; answers?: StoredAnswer[] };
export function mapBooking(booking: BookingWithSummary): BookingSummary {
  return {
    id: booking.id, eventTypeId: booking.eventTypeId, eventTypeName: booking.eventTitleSnapshot || booking.eventType.name,
    eventTitleSnapshot: booking.eventTitleSnapshot || booking.eventType.name,
    locationType: booking.locationTypeSnapshot as BookingSummary["locationType"], locationValue: booking.locationValueSnapshot,
    calendarProvider: booking.calendarProviderSnapshot as BookingSummary["calendarProvider"],
    inviteeName: booking.inviteeName, inviteeEmail: booking.inviteeEmail, inviteeTimeZone: booking.inviteeTimeZone,
    startAt: booking.startAt.toISOString(), endAt: booking.endAt.toISOString(),
    status: booking.status as BookingSummary["status"], notes: booking.notes,
    calendarSyncStatus: booking.calendarSyncStatus as BookingSummary["calendarSyncStatus"],
    notificationStatus: booking.notificationStatus as BookingSummary["notificationStatus"], cancellationReason: booking.cancellationReason,
    hostName: booking.host?.name ?? "Host",
    durationId: booking.durationId, durationMinutes: booking.durationMinutes, priceCents: booking.priceCents, currency: booking.currency,
    bookingWindowDays: booking.bookingWindowDays,
    refundStatus: booking.refundStatus as BookingSummary["refundStatus"], refundedAmountCents: booking.refundedAmountCents,
    answers: booking.answers?.map((answer) => ({
      questionId: answer.questionId, questionLabel: answer.questionLabel, value: JSON.parse(answer.valueJson) as unknown,
    })) ?? [],
  };
}
