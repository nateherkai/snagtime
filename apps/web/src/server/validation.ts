import { z } from "zod";
import { IMAGE_DATA_URL_MAX_CHARS } from "@/server/image-ingestion";

const slug = z.string().trim().min(3).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and hyphens.");
const timeZone = z.string().trim().min(1).max(100).refine((value) => {
  try { Intl.DateTimeFormat(undefined, { timeZone: value }); return true; } catch { return false; }
}, "Use a valid IANA time zone.");

const eventTypeObject = z.object({
  name: z.string().trim().min(2).max(100),
  slug,
  description: z.string().trim().max(1000).nullable().default(null),
  durationMinutes: z.number().int().min(10).max(480),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  locationType: z.enum(["GOOGLE_MEET", "PHONE", "IN_PERSON", "CUSTOM"]),
  locationValue: z.string().trim().max(300).nullable().default(null),
  isActive: z.boolean(),
  bufferBeforeMinutes: z.number().int().min(0).max(240),
  bufferAfterMinutes: z.number().int().min(0).max(240),
  minimumNoticeMinutes: z.number().int().min(0).max(10080),
  bookingWindowDays: z.number().int().min(1).max(365),
  priceCents: z.number().int().min(0).max(10_000_000),
  currency: z.string().trim().toLowerCase().regex(/^[a-z]{3}$/),
  durations: z.array(z.object({
    id: z.string().min(1).max(100).optional(),
    label: z.string().trim().min(1).max(60), durationMinutes: z.number().int().min(10).max(480),
    isDefault: z.boolean(), priceCents: z.number().int().min(0).max(10_000_000),
    currency: z.string().trim().toLowerCase().regex(/^[a-z]{3}$/), position: z.number().int().min(0).max(100),
  })).min(1).max(12).optional(),
  questions: z.array(z.object({
    id: z.string().min(1).max(100).optional(),
    label: z.string().trim().min(1).max(200), kind: z.enum(["TEXT", "TEXTAREA", "SELECT", "CHECKBOX"]),
    required: z.boolean(), options: z.array(z.string().trim().min(1).max(100)).max(20), position: z.number().int().min(0).max(100),
  })).max(20).optional(),
});
export const eventTypeInput = eventTypeObject.superRefine((value, context) => {
  if (value.durations && value.durations.filter((item) => item.isDefault).length !== 1) {
    context.addIssue({ code: "custom", message: "Exactly one duration must be the default.", path: ["durations"] });
  }
});

export const updateEventTypeInput = eventTypeObject.partial().superRefine((value, context) => {
  if (value.durations && value.durations.filter((item) => item.isDefault).length !== 1) {
    context.addIssue({ code: "custom", message: "Exactly one duration must be the default.", path: ["durations"] });
  }
});

export const availabilityInput = z.object({
  timeZone,
  intervals: z.array(z.object({
    id: z.string().optional(),
    dayOfWeek: z.number().int().min(0).max(6),
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(1).max(1440),
  }).refine((value) => value.endMinute > value.startMinute, "End time must be after start time.")).max(50),
  overrides: z.array(z.object({
    id: z.string().optional(), dateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), isAvailable: z.boolean(),
    startMinute: z.number().int().min(0).max(1439).nullable().optional(), endMinute: z.number().int().min(1).max(1440).nullable().optional(),
  }).superRefine((value, context) => {
    if (value.isAvailable && (value.startMinute == null || value.endMinute == null || value.endMinute <= value.startMinute)) {
      context.addIssue({ code: "custom", message: "Available overrides need a valid start and end.", path: ["startMinute"] });
    }
  })).max(100).default([]),
}).superRefine((value, context) => {
  for (const day of Array.from({ length: 7 }, (_, index) => index)) {
    const intervals = value.intervals.filter((item) => item.dayOfWeek === day).sort((a, b) => a.startMinute - b.startMinute);
    intervals.forEach((item, index) => {
      if (index > 0 && intervals[index - 1]!.endMinute > item.startMinute) {
        context.addIssue({ code: "custom", message: "Availability intervals cannot overlap.", path: ["intervals"] });
      }
    });
  }
  for (const dateKey of new Set(value.overrides.map((item) => item.dateKey))) {
    const dateRows = value.overrides.filter((item) => item.dateKey === dateKey);
    if (dateRows.some((item) => !item.isAvailable) && dateRows.some((item) => item.isAvailable)) context.addIssue({ code: "custom", message: "A full-day unavailable override cannot be combined with available hours.", path: ["overrides"] });
    const intervals = dateRows.filter((item) => item.isAvailable).sort((a, b) => (a.startMinute ?? 0) - (b.startMinute ?? 0));
    intervals.forEach((item, index) => {
      if (index > 0 && (intervals[index - 1]!.endMinute ?? 0) > (item.startMinute ?? 0)) context.addIssue({ code: "custom", message: "Availability overrides cannot overlap.", path: ["overrides"] });
    });
  }
});

export const bookingInput = z.object({
  startAt: z.iso.datetime({ offset: true }),
  inviteeName: z.string().trim().min(2).max(120),
  inviteeEmail: z.email().transform((value) => value.toLowerCase()),
  inviteeTimeZone: timeZone,
  notes: z.string().trim().max(2000).optional(),
  durationId: z.string().min(1).max(100).optional(),
  answers: z.array(z.object({ questionId: z.string().min(1).max(100), value: z.unknown() })).max(20).optional(),
});

export const demoLoginInput = z.object({ email: z.email().transform((value) => value.toLowerCase()), password: z.string().min(1).max(200) });
const strongPassword = z.string().min(12).max(200).refine((value) => /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value) && /[^A-Za-z0-9]/.test(value), "Use upper, lower, number, and symbol.");
export const registrationInput = z.object({
  name: z.string().trim().min(2).max(100), email: z.email().transform((value) => value.trim().toLowerCase()),
  password: strongPassword, workspaceName: z.string().trim().min(2).max(100), timeZone,
}).strict();
export const passwordChangeInput = z.object({ currentPassword: z.string().min(1).max(200), newPassword: strongPassword }).strict();
export const workspaceSwitchInput = z.object({ workspaceId: z.string().min(1).max(100) }).strict();
export const workspaceUpdateInput = z.object({ completeOnboarding: z.literal(true) }).strict();
export const invitationInput = z.object({ email: z.email().transform((value) => value.trim().toLowerCase()), role: z.enum(["ADMIN", "MEMBER"]) }).strict();
export const genericEmailInput = z.object({ email: z.email().transform((value) => value.trim().toLowerCase()) }).strict();
export const tokenInput = z.object({ token: z.string().min(40).max(500) }).strict();
export const passwordResetInput = tokenInput.extend({ newPassword: strongPassword }).strict();
export const bookingRecoveryRequestInput = genericEmailInput.extend({ bookingId: z.string().min(1).max(100) }).strict();
export const cancelBookingInput = z.object({ reason: z.string().trim().min(1).max(500).optional() }).strict();
export const rescheduleBookingInput = cancelBookingInput.extend({ startAt: z.iso.datetime({ offset: true }) });
export const bookingCapabilityExchangeInput = z.object({
  read: z.string().min(40).max(600), cancel: z.string().min(40).max(600), reschedule: z.string().min(40).max(600),
}).strict();
export const brandingInput = z.object({
  workspaceName: z.string().trim().min(2).max(100), logoUrl: z.string().max(IMAGE_DATA_URL_MAX_CHARS).nullable(),
  accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/), description: z.string().trim().max(1000).nullable(),
  footerText: z.string().trim().max(300).nullable(),
}).strict();
export const profileImageInput = z.object({ imageUrl: z.string().max(IMAGE_DATA_URL_MAX_CHARS).nullable() }).strict();
