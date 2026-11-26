import type { NextFunction, Request, Response } from "express";

export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction) {
  // 1. If response has already started, delegate to Express
  if (res.headersSent) {
    return next(err);
  }

  // 2. Detect invalid JSON
  const isBadJson = typeof err === "object" && err !== null && "type" in err && err.type === "entity.parse.failed";

  // 3. Log the error
  req.log.error({ err }, "request failed");

  // 4. Determine response
  const status = isBadJson ? 400 : 500;

  res.status(status).json({
    error: {
      code: isBadJson ? "VALIDATION_ERROR" : "INTERNAL_ERROR",
      message: isBadJson ? "Invalid JSON body" : "Something went wrong",
      requestId: req.id,
      details: {},
    },
  });
}
