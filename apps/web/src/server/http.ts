import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AppError } from "@/server/errors";

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ data }, init);
}

export function apiError(error: unknown) {
  if (error instanceof ZodError) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Check the highlighted fields.", fieldErrors: error.flatten().fieldErrors } },
      { status: 422 },
    );
  }
  if (error instanceof AppError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message, fieldErrors: error.fieldErrors } },
      { status: error.status },
    );
  }
  console.error("Unhandled API error", { type: error instanceof Error ? error.name : "unknown" });
  return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "Something went wrong." } }, { status: 500 });
}

export async function readBoundedText(request: Request, maxBytes: number) {
  const declaredText = request.headers.get("content-length"); const declared = declaredText == null ? null : Number(declaredText);
  if (declared != null && (!Number.isSafeInteger(declared) || declared < 0 || declared > maxBytes)) throw new AppError("BODY_TOO_LARGE", "Request body is too large.", 413);
  if (!request.body) return "";
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      total += value.byteLength;
      if (total > maxBytes) { await reader.cancel("BODY_TOO_LARGE"); throw new AppError("BODY_TOO_LARGE", "Request body is too large.", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export async function jsonBody(request: Request, maxBytes = 64 * 1024) {
  try {
    const text = await readBoundedText(request, maxBytes);
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("INVALID_JSON", "Request body must be valid JSON.", 400);
  }
}
