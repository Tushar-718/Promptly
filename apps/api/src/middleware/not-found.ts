import type { Request } from "express";
import { AppError } from "../lib/errors.js";

export function notFound(req: Request) {
  throw new AppError(404, "NOT_FOUND", `Route ${req.method} ${req.path} not found`);
}
