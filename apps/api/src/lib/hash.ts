import bcrypt from "bcryptjs";

const BCRYPT_COST = 12;

export async function hashPassword(plainText: string): Promise<string> {
  return await bcrypt.hash(plainText, BCRYPT_COST);
}

export async function verifyPassword(plainText: string, savedHash: string): Promise<boolean> {
  return await bcrypt.compare(plainText, savedHash);
}
