import { apiError, jsonBody, ok } from "@/server/http";
import { assertSameOrigin } from "@/server/auth/session";
import { manageCookieName, manageCookieOptions } from "@/server/auth/capabilities";
import { clientAddress, enforceRateLimit } from "@/server/rate-limit";
import { bookingRecoveryRequestInput, tokenInput } from "@/server/validation";
import { consumeBookingManageLink, requestBookingManageLink } from "@/server/services/booking-recovery";
export async function POST(request: Request) { try { assertSameOrigin(request); const input = bookingRecoveryRequestInput.parse(await jsonBody(request)); await enforceRateLimit(`booking-recovery:ip:${clientAddress(request)}`, 20, 60 * 60_000); await enforceRateLimit(`booking-recovery:resource:${input.bookingId}:${input.email}`, 5, 60 * 60_000); return ok(await requestBookingManageLink(input.bookingId, input.email), { status: 202 }); } catch (error) { return apiError(error); } }
export async function PUT(request: Request) { try { assertSameOrigin(request); await enforceRateLimit(`booking-recovery-consume:ip:${clientAddress(request)}`, 20, 60 * 60_000); const result = await consumeBookingManageLink(tokenInput.parse(await jsonBody(request)).token); const response = ok({ established: true as const, bookingId: result.bookingId }); response.cookies.set(manageCookieName(result.bookingId), result.token, { ...manageCookieOptions, expires: result.expiresAt }); response.headers.set("Cache-Control", "no-store"); response.headers.set("Referrer-Policy", "no-referrer"); return response; } catch (error) { return apiError(error); } }
