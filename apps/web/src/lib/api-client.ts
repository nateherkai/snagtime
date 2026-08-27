import type {
  ApiFailure,
  ApiResponse,
  AvailabilitySchedule,
  BookingSlot,
  BookingSummary,
  BookingManageCapabilities,
  CreateBookingInput,
  CreateBookingResult,
  CreateEventTypeInput,
  EventTypeSummary,
  SessionUser,
  UpdateEventTypeInput,
  WorkspaceBranding,
  AccountSummary,
  ProfileImageUpdate,
  RegistrationInput,
  RegistrationAccepted,
  WorkspaceInvitation,
  WorkspaceMember,
  GenericRequestAccepted,
  PasswordResetResult,
  EmailVerificationResult,
  InvitationAcceptanceResult,
  LocalInboxMessage,
  ResumeBookingCheckoutResult,
} from "@/lib/contracts";

export class SnagTimeApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body = (await response.json()) as ApiResponse<T>;
  if (!response.ok || "error" in body) {
    const error = (body as ApiFailure).error;
    throw new SnagTimeApiError(error.code, error.message, response.status, error.fieldErrors);
  }
  return body.data;
}

export const snagTimeApi = {
  session: () => request<{ user: SessionUser | null; workspace: AccountSummary["workspace"] | null }>("/api/auth/session"),
  login: (email: string, password: string) => request<{ user: SessionUser }>("/api/auth/session", { method: "POST", body: JSON.stringify({ email, password }) }),
  demoLogin: (email: string, password: string) => request<{ user: SessionUser }>("/api/auth/session", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => request<{ signedOut: true }>("/api/auth/session", { method: "DELETE" }),
  signup: (input: RegistrationInput) => request<RegistrationAccepted>("/api/auth/register", { method: "POST", body: JSON.stringify(input) }),
  requestPasswordReset: (email: string) => request<GenericRequestAccepted>("/api/auth/password-reset/request", { method: "POST", body: JSON.stringify({ email }) }),
  resetPassword: (token: string, newPassword: string) => request<PasswordResetResult>("/api/auth/password-reset/consume", { method: "POST", body: JSON.stringify({ token, newPassword }) }),
  requestEmailVerification: (email: string) => request<GenericRequestAccepted>("/api/auth/verify-email/request", { method: "POST", body: JSON.stringify({ email }) }),
  verifyEmail: (token: string) => request<EmailVerificationResult>("/api/auth/verify-email/consume", { method: "POST", body: JSON.stringify({ token }) }),
  getAccount: () => request<AccountSummary>("/api/account"),
  updateProfileImage: (input: ProfileImageUpdate) => request<SessionUser>("/api/account/profile-image", { method: "PATCH", body: JSON.stringify(input) }),
  changePassword: (currentPassword: string, newPassword: string) => request<{ changed: true; signedOutOtherSessions: true }>("/api/account/security", { method: "PATCH", body: JSON.stringify({ currentPassword, newPassword }) }),
  completeOnboarding: () => request<AccountSummary>("/api/workspace", { method: "PATCH", body: JSON.stringify({ completeOnboarding: true }) }),
  switchWorkspace: (workspaceId: string) => request<AccountSummary>("/api/workspace/switch", { method: "POST", body: JSON.stringify({ workspaceId }) }),
  listWorkspaceMembers: () => request<WorkspaceMember[]>("/api/workspace/members"),
  updateWorkspaceMember: (membershipId: string, role: "OWNER" | "ADMIN" | "MEMBER", status: "ACTIVE" | "REMOVED") => request<{ updated: true }>("/api/workspace/members", { method: "PATCH", body: JSON.stringify({ membershipId, role, status }) }),
  listWorkspaceInvitations: () => request<WorkspaceInvitation[]>("/api/workspace/invitations"),
  createWorkspaceInvitation: (email: string, role: "ADMIN" | "MEMBER") => request<GenericRequestAccepted>("/api/workspace/invitations", { method: "POST", body: JSON.stringify({ email, role }) }),
  acceptWorkspaceInvitation: (token: string) => request<InvitationAcceptanceResult>("/api/workspace/invitations/accept", { method: "POST", body: JSON.stringify({ token }) }),
  listEventTypes: () => request<EventTypeSummary[]>("/api/event-types"),
  getEventType: (id: string) => request<EventTypeSummary>(`/api/event-types/${id}`),
  createEventType: (input: CreateEventTypeInput) => request<EventTypeSummary>("/api/event-types", { method: "POST", body: JSON.stringify(input) }),
  updateEventType: (id: string, input: UpdateEventTypeInput) => request<EventTypeSummary>(`/api/event-types/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  deleteEventType: (id: string) => request<{ deleted: true }>(`/api/event-types/${id}`, { method: "DELETE" }),
  getAvailability: () => request<AvailabilitySchedule>("/api/availability"),
  setAvailability: (schedule: AvailabilitySchedule) => request<AvailabilitySchedule>("/api/availability", { method: "PUT", body: JSON.stringify(schedule) }),
  listBookings: () => request<BookingSummary[]>("/api/bookings"),
  getPublicEventType: (slug: string) => request<EventTypeSummary>(`/api/public/${slug}`),
  getSlots: (slug: string, from: string, to: string, timeZone: string, durationId?: string, signal?: AbortSignal) => request<BookingSlot[]>(`/api/public/${slug}/slots?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&timeZone=${encodeURIComponent(timeZone)}${durationId ? `&durationId=${encodeURIComponent(durationId)}` : ""}`, { signal }),
  createBooking: (slug: string, input: CreateBookingInput, idempotencyKey = crypto.randomUUID()) => request<CreateBookingResult>(`/api/public/${slug}/bookings`, { method: "POST", headers: { "idempotency-key": idempotencyKey }, body: JSON.stringify(input) }),
  resumeBookingCheckout: (id: string) => request<ResumeBookingCheckoutResult>(`/api/bookings/${id}/checkout/resume`, { method: "POST", body: "{}" }),
  exchangeBookingManageSession: (id: string, capabilities: BookingManageCapabilities) => request<{ established: true }>(`/api/bookings/${id}/manage-session`, { method: "POST", body: JSON.stringify({ read: capabilities.read, cancel: capabilities.cancel, reschedule: capabilities.reschedule }) }),
  acknowledgeBookingManageSession: (id: string) => request<{ acknowledged: true }>(`/api/bookings/${id}/manage-session`, { method: "PATCH", body: "{}" }),
  getBookingForManage: (id: string) => request<BookingSummary>(`/api/bookings/${id}`),
  getRescheduleSlots: (id: string, from: string, to: string, timeZone: string, durationId?: string, signal?: AbortSignal) => request<BookingSlot[]>(`/api/bookings/${id}/slots?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&timeZone=${encodeURIComponent(timeZone)}${durationId ? `&durationId=${encodeURIComponent(durationId)}` : ""}`, { signal }),
  rescheduleBooking: (id: string, startAt: string) => request<BookingSummary>(`/api/bookings/${id}`, { method: "PATCH", body: JSON.stringify({ startAt }) }),
  cancelBooking: (id: string, reason?: string) => request<BookingSummary>(`/api/bookings/${id}`, { method: "DELETE", body: JSON.stringify({ reason }) }),
  requestBookingManageLink: (bookingId: string, email: string) => request<GenericRequestAccepted>("/api/bookings/manage-link", { method: "POST", body: JSON.stringify({ bookingId, email }) }),
  consumeBookingManageLink: (token: string) => request<{ established: true; bookingId: string }>("/api/bookings/manage-link", { method: "PUT", body: JSON.stringify({ token }) }),
  getWorkspaceBranding: () => request<WorkspaceBranding>("/api/settings/branding"),
  updateWorkspaceBranding: (input: WorkspaceBranding) => request<WorkspaceBranding>("/api/settings/branding", { method: "PUT", body: JSON.stringify(input) }),
  getGoogleStatus: () => request<{ configured: boolean; connected: boolean; credentialSource: "encrypted_database" | "environment" | "none"; disconnectSupported: boolean; disconnectPending: boolean; provider: "google" | "local"; requestedProvider: "google" | "local"; calendarId: string }>("/api/integrations/google/status"),
  googleAuthorizePath: "/api/integrations/google/authorize",
  disconnectGoogle: () => request<{ disconnected: true }>("/api/integrations/google/status", { method: "DELETE" }),
  getIntegrationStatus: () => request<{ google: { configured: boolean; connected: boolean; credentialSource: "encrypted_database" | "environment" | "none"; disconnectSupported: boolean; disconnectPending: boolean; provider: "google" | "local"; requestedProvider: "google" | "local"; calendarId: string; scopeHealth: "complete" | "insufficient" | "unavailable"; missingScopes: string[] }; stripe: { configured: boolean; mode: "test" }; outboxWorker: { enabled: boolean; activation: "next-node-instrumentation"; productionScheduler: "deferred" } }>("/api/integrations/status"),
  retryIntegrationOutbox: () => request<{ integrations: { attempted: number; pending: number }; email: { attempted: number; pending: number } }>("/api/integrations/outbox", { method: "POST" }),
  listLocalEmailInbox: () => request<LocalInboxMessage[]>("/api/integrations/email/inbox"),
  retryEmailOutbox: () => request<{ attempted: number; pending: number }>("/api/integrations/email/inbox", { method: "POST" }),
};
