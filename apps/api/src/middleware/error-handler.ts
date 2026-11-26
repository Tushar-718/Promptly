import type { NextFunction, Request, Response } from "express";
import { AppError } from "../lib/errors.js";

// Turns any thrown value into an AppError, so there is only one thing to format.
function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;

  // express.json() marks its errors with a "type" property
  if (typeof err === "object" && err !== null && "type" in err) {
    if (err.type === "entity.parse.failed") {
      return new AppError(400, "VALIDATION_ERROR", "Invalid JSON body");
    }
    if (err.type === "entity.too.large") {
      return new AppError(413, "INPUT_TOO_LONG", "Request body is too large");
    }
  }

  // Anything else is unexpected: never show its message to the client
  return new AppError(500, "INTERNAL_ERROR", "Something went wrong");
}

export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction) {
  if (res.headersSent) {
    return next(err);
  }

  const appError = toAppError(err);

  // 5xx = our fault (log as error). 4xx = client's mistake (log as warning).
  if (appError.statusCode >= 500) {
    req.log.error({ err }, "request failed");
  } else {
    req.log.warn({ code: appError.code }, appError.message);
  }

  res.status(appError.statusCode).json({
    error: {
      code: appError.code,
      message: appError.message,
      details: appError.details,
      requestId: req.id,
    },
  });
}
