import type { BookingAnswer, WorkspaceBranding } from "@/lib/contracts";

export type EventStatus = "published" | "draft" | "archived";
export type BookingStatus = "confirmed" | "pending" | "canceled";
export type IntegrationStatus = "connected" | "attention" | "available";

export interface DurationOption { id?: string; minutes: number; label: string; isDefault: boolean; price?: number; currency?: string }
export interface CustomQuestionView { id?: string; label: string; kind: "TEXT" | "TEXTAREA" | "SELECT" | "CHECKBOX"; required: boolean; options: string[] }
export interface EventType {
  id: string; title: string; slug: string; description: string; color: string; status: EventStatus;
  location: string; locationType: "GOOGLE_MEET" | "PHONE" | "IN_PERSON" | "CUSTOM"; locationValue: string | null;
  durations: DurationOption[]; questions: CustomQuestionView[];
  bookingWindowDays: number; bufferBeforeMinutes: number;
  bufferAfterMinutes: number; minimumNoticeMinutes: number; bookingCount: number; hostName: string; branding?: WorkspaceBranding | null;
}
export interface Booking {
  id: string; eventTypeId: string; eventSlug?: string; invitee: string; email: string; eventTitle: string; startsAt: string; dateLabel: string;
  timeLabel: string; duration: number; timezone: string; organizerTimeZone: string; status: BookingStatus; hostName: string;
  notificationStatus: "PENDING" | "GOOGLE_UPDATE_ACCEPTED" | "LOCAL_NO_EMAIL" | "RETRY_PENDING"; location?: string;
  answers: BookingAnswer[]; cancellationReason?: string; notes?: string;
}
export interface AvailabilityWindow { id: string; start: string; end: string }
export interface AvailabilityDay { day: string; short: string; enabled: boolean; windows: AvailabilityWindow[] }
export interface Integration { id: string; name: string; category: string; description: string; status: IntegrationStatus; detail?: string; mark: string; markTone: string }
