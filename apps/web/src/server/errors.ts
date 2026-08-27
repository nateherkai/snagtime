export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
    public readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
  }
}

export const notFound = (resource: string) => new AppError("NOT_FOUND", `${resource} was not found.`, 404);
export const unauthorized = () => new AppError("UNAUTHORIZED", "Sign in to continue.", 401);
export const conflict = (message: string) => new AppError("CONFLICT", message, 409);
