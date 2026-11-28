import bcrypt from "bcryptjs";
import { createHash } from "node:crypto";

const BCRYPT_COST = 12;

export async function hashPassword(plainText: string): Promise<string> {
  return await bcrypt.hash(plainText, BCRYPT_COST);
}

export async function verifyPassword(plainText: string, savedHash: string): Promise<boolean> {
  return await bcrypt.compare(plainText, savedHash);
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
