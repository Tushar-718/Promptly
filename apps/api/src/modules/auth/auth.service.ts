import { type RegisterInput } from "@promptly/shared";
import { db } from "../../db/client.js";
import { hashPassword } from "../../lib/hash.js";
import { users } from "../../db/schema/users.js";
import { AppError } from "../../lib/errors.js";

export async function register(input: RegisterInput) {
  try {
    // 1. Hash password
    const passwordHash = await hashPassword(input.password);

    // 2. Insert user
    const [user] = await db
      .insert(users)
      .values({
        email: input.email,
        name: input.name,
        passwordHash,
      })
      .returning({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
      });

    // 3. Ensure user was created
    if (!user) {
      throw new Error("User registration failed");
    }

    // 4. Return safe user fields only
    return user;
  } catch (error) {
    // 5. Detect duplicate email
    const code = (error as { cause?: { code?: string } }).cause?.code;

    if (code === "23505") {
      throw new AppError(409, "CONFLICT", "Email is already registered");
    }

    // 6. Preserve unexpected errors
    throw error;
  }
}
