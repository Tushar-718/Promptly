import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { AppError } from "../lib/errors.js";

export function validateBody(schema: z.ZodType) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const { fieldErrors } = z.flattenError(result.error);
      throw new AppError(400, "VALIDATION_ERROR", "Invalid request body", fieldErrors);
    }

    // Replace the raw input with the cleaned, validated data
    req.body = result.data;
    next();
  };
}
