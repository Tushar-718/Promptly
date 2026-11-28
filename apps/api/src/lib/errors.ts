export type ErrorCode = "VALIDATION_ERROR" | "NOT_FOUND" | "INPUT_TOO_LONG" | "INTERNAL_ERROR" | "CONFLICT";

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly details: Record<string, unknown>;

  constructor(statusCode: number, code: ErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}
