import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

const pattern = /^[\w-]{1,100}$/;

export function requestId(req: Request, res: Response, next: NextFunction) {
  const incomingId = req.header("x-request-id");

  const id = incomingId && pattern.test(incomingId) ? incomingId : randomUUID();

  req.id = id;
  res.setHeader("x-request-id", id);

  next();
}
