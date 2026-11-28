import jwt from "jsonwebtoken";
import { randomBytes } from "node:crypto";
import { z } from "zod";

import { env } from "../config/env.js";

const payloadSchema = z.object({
  sub: z.string().uuid(),
  role: z.enum(["user", "admin"]),
});

export type UserRole = z.infer<typeof payloadSchema>["role"];

export function signAccessToken(userId: string, role: UserRole): string {
  return jwt.sign({ role }, env.JWT_ACCESS_SECRET, {
    algorithm: "HS256",
    subject: userId,
    expiresIn: env.ACCESS_TOKEN_TTL as NonNullable<jwt.SignOptions["expiresIn"]>,
  });
}

export function verifyAccessToken(token: string): { userId: string; role: UserRole } {
  const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, {
    algorithms: ["HS256"],
  });

  const payload = payloadSchema.parse(decoded);

  return {
    userId: payload.sub,
    role: payload.role,
  };
}

export function generateRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}
