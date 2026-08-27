export type ApiSuccess<T> = { data: T };
export type ApiFailure = { error: { code: string; message: string; fieldErrors?: Record<string, string[]> } };
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export type SessionUser = { id: string; email: string; name: string; imageUrl: string | null; timeZone: string };
export type ProfileImageUpdate = { imageUrl: string | null };
export type WorkspaceRole = "OWNER" | "ADMIN" | "MEMBER";
export type WorkspaceSummary = { id: string; name: string; timeZone: string; role: WorkspaceRole; onboardingCompleted: boolean };
export type WorkspaceMember = { id: string; userId: string; name: string; email: string; role: WorkspaceRole; status: "ACTIVE" | "REMOVED" };
export type WorkspaceInvitation = { id: string; email: string; role: "ADMIN" | "MEMBER"; status: "PENDING" | "REVOKED" | "ACCEPTED" | "EXPIRED"; expiresAt: string };
export type AccountSummary = { user: SessionUser; workspace: WorkspaceSummary; workspaces: WorkspaceSummary[]; members: WorkspaceMember[] };
export type RegistrationInput = { name: string; email: string; password: string; workspaceName: string; timeZone: string };
export type RegistrationAccepted = { accepted: true; verificationPending: true };
export type GenericRequestAccepted = { accepted: true };
export type PasswordResetResult = { reset: true; signInRequired: true };
export type EmailVerificationResult = { verified: true };
export type InvitationAcceptanceResult = { accepted: true; workspaceId: string };
export type LocalInboxMessage = { id: string; recipientEmail: string; subject: string; text: string; createdAt: string };

export type EventDurationOption = {
  id: string; label: string; durationMinutes: number; isDefault: boolean;
  priceCents: number; currency: string; position: number;
};
export type CustomQuestion = {
  id: string; label: string; kind: "TEXT" | "TEXTAREA" | "SELECT" | "CHECKBOX";
  required: boolean; options: string[]; position: number;
};
export type EventTypeSummary = {
  id: string; name: string; slug: string; description: string | null; durationMinutes: number;
  color: string; locationType: "GOOGLE_MEET" | "PHONE" | "IN_PERSON" | "CUSTOM";
  locationValue: string | null; isActive: boolean; bufferBeforeMinutes: number;
  bufferAfterMinutes: number; minimumNoticeMinutes: number; bookingWindowDays: number;
  priceCents: number; currency: string; bookingUrl: string;
  durations: EventDurationOption[]; questions: CustomQuestion[]; branding: WorkspaceBranding | null;
  bookingCount: number; hostName: string;
};

export type AvailabilityInterval = { id?: string; dayOfWeek: number; startMinute: number; endMinute: number };
export type AvailabilityOverride = {
  id?: string; dateKey: string; isAvailable: boolean; startMinute?: number | null; endMinute?: number | null;
};
export type AvailabilitySchedule = { timeZone: string; intervals: AvailabilityInterval[]; overrides?: AvailabilityOverride[] };

export type BookingSlot = {
  start: string; end: string; timeZone: string; durationId: string;
  durationMinutes: number; priceCents: number; currency: string;
};
export type BookingAnswer = { questionId: string | null; questionLabel: string; value: unknown };
export type BookingSummary = {
  id: string; eventTypeId: string; eventTypeName: string; inviteeName: string; inviteeEmail: string;
  eventTitleSnapshot: string; locationType: "GOOGLE_MEET" | "PHONE" | "IN_PERSON" | "CUSTOM";
  locationValue: string | null; calendarProvider: "google" | "local" | "provider_recovery_required";
  inviteeTimeZone: string; startAt: string; endAt: string;
  status: "PENDING_PAYMENT" | "CONFIRMED" | "CANCELLED" | "RESCHEDULED";
  notes: string | null; calendarSyncStatus: "LOCAL" | "PENDING" | "SYNCED" | "FAILED";
  notificationStatus: "PENDING" | "GOOGLE_UPDATE_ACCEPTED" | "LOCAL_NO_EMAIL" | "RETRY_PENDING";
  cancellationReason: string | null; hostName: string;
  durationId: string | null; durationMinutes: number; priceCents: number; currency: string;
  bookingWindowDays: number;
  refundStatus: "NOT_REQUIRED" | "REFUND_PENDING" | "REFUNDED" | "REFUND_FAILED";
  refundedAmountCents: number;
  answers: BookingAnswer[];
};
export type BookingManageCapabilities = { read: string; cancel: string; reschedule: string; expiresAt: string };
export type WorkspaceBranding = {
  workspaceName: string; logoUrl: string | null; accentColor: string;
  description: string | null; footerText: string | null;
};

export type CreateEventTypeInput = Omit<EventTypeSummary, "id" | "bookingUrl" | "durations" | "questions" | "branding" | "bookingCount" | "hostName"> & {
  durations?: Array<Omit<EventDurationOption, "id"> & { id?: string }>;
  questions?: Array<Omit<CustomQuestion, "id"> & { id?: string }>;
};
export type UpdateEventTypeInput = Partial<CreateEventTypeInput>;
export type CreateBookingInput = {
  startAt: string; inviteeName: string; inviteeEmail: string; inviteeTimeZone: string;
  notes?: string; durationId?: string; answers?: Array<{ questionId: string; value: unknown }>;
};
export type CreateBookingResult = {
  bookingId: string; status: BookingSummary["status"]; checkoutUrl: string | null;
  checkoutState: "NOT_REQUIRED" | "READY" | "RETRY_REQUIRED";
  manageSessionEstablished: boolean;
  /** @deprecated Server establishes the opaque HttpOnly manage session. */
  manageCapabilities: null;
};
export type ResumeBookingCheckoutResult = {
  bookingId: string; status: BookingSummary["status"];
  checkoutState: "NOT_REQUIRED" | "READY" | "RETRY_REQUIRED";
  checkoutUrl: string | null;
};
